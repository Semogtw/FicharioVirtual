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
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job_id uuid;
  target_job_status public.ocr_status;
  target_page_status public.page_status;
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

  target_job_status := case
    when retryable then 'retryable'::public.ocr_status
    else 'failed'::public.ocr_status
  end;
  target_page_status := case
    when retryable then 'retryable'::public.page_status
    else 'failed'::public.page_status
  end;

  update public.ocr_jobs
  set status = target_job_status,
      last_error_code = error_code,
      last_error_message = safe_error_message,
      next_retry_at = case when retryable then retry_at else null end,
      finished_at = case when retryable then null else failed_at end
  where id = target_job_id;

  update public.pages
  set status = target_page_status
  where id = target_page_id
    and user_id = current_user_id;

  return true;
end;
$$;
