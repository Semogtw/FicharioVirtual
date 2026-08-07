-- Keep retry transitions strongly typed as drive_sync_status.

create or replace function public.retry_drive_sync_job(
  target_user_id uuid,
  target_job_id uuid,
  worker_id text,
  target_error_code text,
  target_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if target_user_id is null
    or target_job_id is null
    or worker_id is null
    or char_length(worker_id) not between 1 and 160
    or worker_id ~ '[[:cntrl:]]'
    or target_error_code is null
    or target_error_code !~ '^[a-z0-9_]{1,64}$'
    or target_error_message is null
    or char_length(target_error_message) not between 1 and 500
    or target_error_message ~ '[[:cntrl:]]'
  then
    raise invalid_parameter_value using message = 'Invalid Drive retry state';
  end if;

  update public.drive_sync_jobs as job
  set
    status = case
      when job.attempt_count >= 8 then 'failed'::public.drive_sync_status
      else 'retryable'::public.drive_sync_status
    end,
    next_retry_at = case
      when job.attempt_count >= 8 then null
      else timezone('utc', now())
        + make_interval(secs => least(3600, (5 * power(2, least(job.attempt_count, 10)))::integer))
    end,
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = target_error_code,
    last_error_message = target_error_message,
    finished_at = case when job.attempt_count >= 8 then timezone('utc', now()) else null end
  where job.id = target_job_id
    and job.user_id = target_user_id
    and job.status = 'processing'
    and job.lease_owner = worker_id;

  get diagnostics changed_count = row_count;

  update public.notebooks as notebook
  set drive_sync_status = 'failed'
  from public.drive_sync_jobs as job
  where changed_count = 1
    and job.id = target_job_id
    and job.status = 'failed'
    and notebook.id = job.notebook_id
    and notebook.user_id = target_user_id;

  update public.documents as document
  set drive_sync_status = 'failed'
  from public.drive_sync_jobs as job
  where changed_count = 1
    and job.id = target_job_id
    and job.status = 'failed'
    and document.id = job.document_id
    and document.user_id = target_user_id;

  return changed_count = 1;
end;
$$;

revoke execute on function public.retry_drive_sync_job(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.retry_drive_sync_job(uuid, uuid, text, text, text)
  to service_role;
