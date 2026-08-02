alter table public.app_users
  add column ocr_consent_at timestamptz,
  add column ocr_consent_version integer
    check (ocr_consent_version is null or ocr_consent_version >= 1);

create or replace function public.record_ocr_consent(consent_version integer default 1)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed_rows integer;
begin
  if current_user_id is null or consent_version < 1 or consent_version > 1000 then
    return false;
  end if;

  update public.app_users
  set ocr_consent_at = timezone('utc', now()),
      ocr_consent_version = greatest(coalesce(ocr_consent_version, 0), consent_version)
  where user_id = current_user_id
    and is_active = true;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

create or replace function public.claim_ocr_job(
  target_page_id uuid,
  target_model text,
  claimed_at timestamptz,
  daily_hard_limit integer
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
    select 1 from public.app_users
    where user_id = current_user_id
      and is_active = true
      and ocr_consent_at is not null
      and ocr_consent_version >= 1
  ) then
    return jsonb_build_object('state', 'consent_required');
  end if;
  if target_model is null or char_length(target_model) not between 3 and 128
    or target_model !~ '^[A-Za-z0-9._-]+$'
    or daily_hard_limit < 1 or daily_hard_limit > 10000
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

  insert into public.usage_daily (
    user_id,
    usage_date,
    ocr_pages,
    updated_at
  ) values (
    current_user_id,
    (claimed_at at time zone 'utc')::date,
    1,
    claimed_at
  )
  on conflict (user_id, usage_date) do update
  set ocr_pages = public.usage_daily.ocr_pages + 1,
      updated_at = excluded.updated_at
  where public.usage_daily.ocr_pages < daily_hard_limit
  returning ocr_pages into usage_count;

  if usage_count is null or usage_count > daily_hard_limit then
    update public.ocr_jobs
    set status = 'blocked_quota',
        last_error_code = 'daily_hard_limit',
        started_at = null
    where id = current_job.job_id;

    update public.pages
    set status = 'blocked_quota'
    where id = target_page_id and user_id = current_user_id;

    return jsonb_build_object('state', 'quota_exhausted', 'jobId', current_job.job_id);
  end if;

  update public.pages
  set status = 'processing'
  where id = target_page_id and user_id = current_user_id;

  return jsonb_build_object(
    'state', 'claimed',
    'jobId', current_job.job_id,
    'attemptCount', current_job.attempt_count + 1,
    'usageToday', usage_count
  );
end;
$$;

create or replace function public.complete_ocr_job(
  target_page_id uuid,
  extracted_text text,
  extraction_warnings jsonb,
  terminal_status text,
  completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job_id uuid;
begin
  if current_user_id is null
    or terminal_status not in ('ready', 'needs_review')
    or extracted_text is null
    or char_length(extracted_text) > 1000000
    or jsonb_typeof(extraction_warnings) <> 'array'
  then
    return false;
  end if;

  select id into target_job_id
  from public.ocr_jobs
  where page_id = target_page_id
    and user_id = current_user_id
    and status = 'processing'
  for update;

  if not found then return false; end if;

  update public.pages
  set ocr_raw_text = extracted_text,
      warnings = extraction_warnings,
      extraction_source = 'ocr',
      status = terminal_status::public.processing_status
  where id = target_page_id
    and user_id = current_user_id;

  update public.ocr_jobs
  set status = 'ready',
      finished_at = completed_at,
      last_error_code = null,
      last_error_message = null,
      next_retry_at = null
  where id = target_job_id;

  return true;
end;
$$;

create or replace function public.fail_ocr_job(
  target_page_id uuid,
  error_code text,
  safe_error_message text,
  retryable boolean,
  failed_at timestamptz,
  retry_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job_id uuid;
  target_status public.processing_status;
begin
  if current_user_id is null
    or error_code !~ '^[a-z0-9_]{1,64}$'
    or safe_error_message is null
    or char_length(safe_error_message) > 500
    or (retryable and (retry_at is null or retry_at <= failed_at))
  then
    return false;
  end if;

  select id into target_job_id
  from public.ocr_jobs
  where page_id = target_page_id
    and user_id = current_user_id
    and status = 'processing'
  for update;

  if not found then return false; end if;
  target_status := case when retryable then 'retryable' else 'failed' end;

  update public.ocr_jobs
  set status = target_status,
      last_error_code = error_code,
      last_error_message = safe_error_message,
      next_retry_at = case when retryable then retry_at else null end,
      finished_at = case when retryable then null else failed_at end
  where id = target_job_id;

  update public.pages
  set status = target_status
  where id = target_page_id
    and user_id = current_user_id;

  return true;
end;
$$;

create or replace function public.clear_temporary_page_image(
  target_page_id uuid,
  expected_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed_rows integer;
begin
  if current_user_id is null or expected_storage_path is null then return false; end if;

  update public.pages
  set temporary_image_path = null
  where id = target_page_id
    and user_id = current_user_id
    and temporary_image_path = expected_storage_path
    and status in ('ready', 'needs_review');

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke execute on function public.record_ocr_consent(integer) from public, anon;
grant execute on function public.record_ocr_consent(integer) to authenticated;
revoke execute on function public.claim_ocr_job(uuid, text, timestamptz, integer) from public, anon;
grant execute on function public.claim_ocr_job(uuid, text, timestamptz, integer) to authenticated;
revoke execute on function public.complete_ocr_job(uuid, text, jsonb, text, timestamptz) from public, anon;
grant execute on function public.complete_ocr_job(uuid, text, jsonb, text, timestamptz) to authenticated;
revoke execute on function public.fail_ocr_job(uuid, text, text, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function public.fail_ocr_job(uuid, text, text, boolean, timestamptz, timestamptz) to authenticated;
revoke execute on function public.clear_temporary_page_image(uuid, text) from public, anon;
grant execute on function public.clear_temporary_page_image(uuid, text) to authenticated;
