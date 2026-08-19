-- Launch baseline cleanup: the product has no pre-launch user data to migrate.
-- Keep historical migrations immutable, but remove compatibility-only objects from the resulting schema.

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

-- No separate activation/consent receipts are needed for actions the user explicitly initiates.
drop function if exists public.record_ocr_consent(integer);
drop function if exists public.record_search_semantic_consent(integer);
drop function if exists public.has_search_semantic_consent(integer);
drop function if exists public.record_coverage_semantic_consent(integer);
drop function if exists public.has_coverage_semantic_consent(integer);

alter table public.app_users
  drop column if exists ocr_consent_at,
  drop column if exists ocr_consent_version,
  drop column if exists search_semantic_consent_at,
  drop column if exists search_semantic_consent_version,
  drop column if exists coverage_semantic_consent_at,
  drop column if exists coverage_semantic_consent_version;

-- Only PKCE OAuth exists at launch. Verifier-less states can only come from pre-launch code.
delete from private.drive_oauth_states where code_verifier is null;
drop function if exists public.store_drive_oauth_state(uuid, text, text, timestamptz);
drop function if exists public.consume_drive_oauth_state(text, timestamptz);
alter table private.drive_oauth_states alter column code_verifier set not null;

-- Current status enums are native contracts; assignment casts were only migration aids.
drop cast if exists (public.processing_status as public.page_status);
drop cast if exists (public.processing_status as public.ocr_status);
drop function if exists public.processing_status_to_page_status(public.processing_status);
drop function if exists public.processing_status_to_ocr_status(public.processing_status);

-- Large Drive PDFs must publish through the renewable descriptor-lease protocol.
drop function if exists public.finalize_drive_pdf_reference_import(uuid, jsonb, integer);
