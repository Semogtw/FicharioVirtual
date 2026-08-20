-- Keep public accounts out of every Gemini background candidate path while the
-- public Azure provider is activated independently. The existing `gemini` route
-- remains a cloud-runtime route; provider identity is persisted separately.

alter table public.ocr_results
  drop constraint if exists ocr_results_provider_check;

alter table public.ocr_results
  add constraint ocr_results_provider_check check (
    provider in ('gemini', 'local', 'azure_vision')
  );

-- `process-ocr` is the Gemini cloud runtime. Guard its claim primitive at the
-- database boundary so a public account cannot reach Gemini even by calling the
-- Edge Function directly. Azure gets a separate claim path in the next migration.
create or replace function public.claim_ocr_job(
  target_page_id uuid,
  target_model text,
  claimed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_job record;
  usage_count integer;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    return jsonb_build_object('state', 'not_authorized');
  end if;
  if not exists (
    select 1
      from public.app_users as app_user
     where app_user.user_id = current_user_id
       and app_user.is_active = true
       and app_user.provider_profile = 'owner'
  ) then
    return jsonb_build_object('state', 'not_authorized');
  end if;
  if target_model is null
    or char_length(target_model) not between 3 and 128
    or target_model !~ '^[A-Za-z0-9._-]+$'
  then
    return jsonb_build_object('state', 'invalid_configuration');
  end if;

  select
    j.id as job_id,
    j.status as job_status,
    j.attempt_count,
    j.next_retry_at,
    p.status as page_status,
    coalesce(nullif(p.corrected_text, ''), nullif(p.ocr_raw_text, '')) as existing_text
  into current_job
  from public.ocr_jobs j
  join public.pages p on p.id = j.page_id and p.user_id = j.user_id
  where j.page_id = target_page_id
    and j.user_id = current_user_id
  for update of j, p;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
  if current_job.existing_text is not null
    and current_job.page_status in ('ready', 'needs_review')
  then
    return jsonb_build_object('state', 'already_complete', 'jobId', current_job.job_id);
  end if;
  if current_job.job_status = 'processing' then
    return jsonb_build_object('state', 'busy', 'jobId', current_job.job_id);
  end if;
  if current_job.next_retry_at is not null and current_job.next_retry_at > claimed_at then
    return jsonb_build_object(
      'state', 'retry_later',
      'jobId', current_job.job_id,
      'nextRetryAt', current_job.next_retry_at
    );
  end if;
  if current_job.job_status not in ('pending', 'retryable', 'blocked_quota') then
    return jsonb_build_object('state', 'not_retryable', 'jobId', current_job.job_id);
  end if;

  update public.ocr_jobs
  set status = 'processing',
      model = target_model,
      attempt_count = attempt_count + 1,
      last_error_code = null,
      last_error_message = null,
      next_retry_at = null,
      started_at = claimed_at,
      finished_at = null
  where id = current_job.job_id;

  update public.pages
  set status = 'processing'
  where id = target_page_id and user_id = current_user_id;

  insert into public.usage_daily (
    user_id, usage_date, ocr_pages, ocr_attempts, updated_at
  ) values (
    current_user_id, (claimed_at at time zone 'utc')::date, 1, 1, claimed_at
  )
  on conflict (user_id, usage_date) do update
  set ocr_pages = public.usage_daily.ocr_pages + 1,
      ocr_attempts = public.usage_daily.ocr_attempts + 1,
      updated_at = excluded.updated_at
  returning ocr_pages into usage_count;

  return jsonb_build_object(
    'state', 'claimed',
    'jobId', current_job.job_id,
    'attemptCount', current_job.attempt_count + 1,
    'usageToday', usage_count
  );
end;
$$;

revoke execute on function public.claim_ocr_job(uuid, text, timestamptz) from public, anon;
grant execute on function public.claim_ocr_job(uuid, text, timestamptz) to authenticated, service_role;

create or replace function public.list_gemini_ocr_candidates()
returns table (
  job_id uuid,
  page_id uuid,
  document_id uuid,
  document_title text,
  page_number integer,
  attempt_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if not exists (
    select 1
      from public.app_users as app_user
     where app_user.user_id = current_user_id
       and app_user.is_active = true
       and app_user.provider_profile = 'owner'
  ) then
    return;
  end if;

  return query
  select
    job.id,
    job.page_id,
    page.document_id,
    document.title,
    page.page_number,
    job.attempt_count,
    job.created_at,
    job.updated_at
  from public.ocr_jobs as job
  join public.pages as page
    on page.id = job.page_id
   and page.user_id = job.user_id
  join public.documents as document
    on document.id = page.document_id
   and document.user_id = job.user_id
  where job.user_id = current_user_id
    and job.route = 'gemini'::public.ocr_route
    and job.status = 'pending'::public.ocr_status
    and page.status = 'pending'::public.page_status
    and job.desktop_lease_device_id is null
    and job.desktop_lease_id is null
    and job.desktop_lease_started_at is null
    and job.desktop_lease_expires_at is null
  order by job.created_at, job.id
  limit 100;
end;
$$;

create or replace function public.list_background_gemini_ocr_candidates(result_limit integer default 24)
returns table (
  user_id uuid,
  job_id uuid,
  page_id uuid,
  document_id uuid,
  page_number integer,
  attempt_count integer,
  batch_id uuid,
  temporary_image_path text,
  document_kind public.document_kind,
  document_storage_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if result_limit is null or result_limit < 1 or result_limit > 100 then
    raise exception using errcode = '22023', message = 'Invalid background OCR limit';
  end if;

  return query
  select
    job.user_id,
    job.id,
    page.id,
    page.document_id,
    page.page_number,
    job.attempt_count,
    job.batch_id,
    page.temporary_image_path,
    document.kind,
    document.storage_path
  from public.ocr_jobs as job
  join public.pages as page
    on page.id = job.page_id
   and page.user_id = job.user_id
  join public.documents as document
    on document.id = page.document_id
   and document.user_id = job.user_id
  join public.app_users as app_user
    on app_user.user_id = job.user_id
   and app_user.is_active = true
   and app_user.provider_profile = 'owner'
  where job.route = 'gemini'::public.ocr_route
    and (
      (
        job.status in ('pending'::public.ocr_status, 'retryable'::public.ocr_status)
        and (job.next_retry_at is null or job.next_retry_at <= timezone('utc', now()))
      )
      or (
        job.status = 'blocked_quota'::public.ocr_status
        and job.next_retry_at is not null
        and job.next_retry_at <= timezone('utc', now())
      )
    )
    and page.status in (
      'pending'::public.page_status,
      'retryable'::public.page_status,
      'blocked_quota'::public.page_status
    )
    and job.desktop_lease_device_id is null
    and job.desktop_lease_id is null
    and job.desktop_lease_started_at is null
    and job.desktop_lease_expires_at is null
    and (
      page.temporary_image_path is not null
      or (document.kind = 'image'::public.document_kind and document.storage_path is not null)
    )
  order by job.created_at, job.id
  limit result_limit;
end;
$$;

revoke execute on function public.list_gemini_ocr_candidates() from public, anon;
grant execute on function public.list_gemini_ocr_candidates() to authenticated, service_role;

revoke execute on function public.list_background_gemini_ocr_candidates(integer)
from public, anon, authenticated;
grant execute on function public.list_background_gemini_ocr_candidates(integer)
to service_role;
