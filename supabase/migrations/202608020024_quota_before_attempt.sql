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
  next_utc_day timestamptz := (
    date_trunc('day', claimed_at at time zone 'utc') + interval '1 day'
  ) at time zone 'utc';
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
        last_error_message = 'O limite diário local foi atingido.',
        next_retry_at = next_utc_day,
        started_at = null,
        finished_at = null
    where id = current_job.job_id;

    update public.pages
    set status = 'blocked_quota'
    where id = target_page_id and user_id = current_user_id;

    return jsonb_build_object(
      'state', 'quota_exhausted',
      'jobId', current_job.job_id,
      'nextRetryAt', next_utc_day
    );
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

  return jsonb_build_object(
    'state', 'claimed',
    'jobId', current_job.job_id,
    'attemptCount', current_job.attempt_count + 1,
    'usageToday', usage_count
  );
end;
$$;

revoke execute on function public.claim_ocr_job(uuid, text, timestamptz, integer) from public, anon;
grant execute on function public.claim_ocr_job(uuid, text, timestamptz, integer) to authenticated;
