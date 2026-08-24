-- Public OCR has its own claim boundary. It is deliberately separate from the
-- Gemini claim RPC so a public session cannot select or reach the owner route.

create or replace function public.claim_public_azure_ocr_job(
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
       and app_user.provider_profile = 'public'
  ) then
    return jsonb_build_object('state', 'not_authorized');
  end if;
  if target_model is distinct from 'read-v3.2' then
    return jsonb_build_object('state', 'invalid_configuration');
  end if;

  select
    j.id as job_id,
    j.status as job_status,
    j.route as job_route,
    j.attempt_count,
    j.next_retry_at,
    p.status as page_status,
    coalesce(nullif(p.corrected_text, ''), nullif(p.ocr_raw_text, '')) as existing_text
  into current_job
  from public.ocr_jobs as j
  join public.pages as p
    on p.id = j.page_id
   and p.user_id = j.user_id
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
  if current_job.job_route is distinct from 'gemini'::public.ocr_route then
    return jsonb_build_object('state', 'not_retryable', 'jobId', current_job.job_id);
  end if;

  update public.ocr_jobs
     set status = 'processing',
         provider = 'azure_vision',
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
   where id = target_page_id
     and user_id = current_user_id;

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

revoke execute on function public.claim_public_azure_ocr_job(uuid, text, timestamptz)
  from public, anon;
grant execute on function public.claim_public_azure_ocr_job(uuid, text, timestamptz)
  to authenticated;
