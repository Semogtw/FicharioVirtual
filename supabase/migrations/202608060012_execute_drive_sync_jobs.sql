create or replace function public.claim_drive_sync_job_for_user(
  target_user_id uuid,
  worker_id text,
  lease_seconds integer default 60
)
returns table (
  id uuid,
  operation public.drive_sync_operation,
  document_id uuid,
  notebook_id uuid,
  drive_file_id text,
  payload jsonb,
  attempt_count integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null
    or worker_id is null
    or char_length(worker_id) not between 1 and 160
    or worker_id ~ '[[:cntrl:]]'
    or lease_seconds not between 15 and 900
  then
    raise invalid_parameter_value using message = 'Invalid Drive worker lease';
  end if;

  if not exists (
    select 1
    from public.app_users as app_user
    join public.drive_connections as connection
      on connection.user_id = app_user.user_id
     and connection.status in ('connected', 'syncing', 'error')
    where app_user.user_id = target_user_id
      and app_user.is_active
  ) then
    raise insufficient_privilege using message = 'Drive worker user is not authorized';
  end if;

  return query
  with candidate as (
    select job.id
    from public.drive_sync_jobs as job
    where job.user_id = target_user_id
      and (
        job.status in ('pending', 'retryable')
        or (
          job.status = 'processing'
          and job.lease_expires_at <= timezone('utc', now())
        )
      )
      and (job.next_retry_at is null or job.next_retry_at <= timezone('utc', now()))
      and (job.lease_expires_at is null or job.lease_expires_at <= timezone('utc', now()))
    order by job.created_at, job.id
    for update skip locked
    limit 1
  )
  update public.drive_sync_jobs as job
  set
    status = 'processing',
    lease_owner = worker_id,
    lease_expires_at = timezone('utc', now()) + make_interval(secs => lease_seconds),
    attempt_count = job.attempt_count + 1,
    next_retry_at = null,
    last_error_code = null,
    last_error_message = null
  from candidate
  where job.id = candidate.id
  returning
    job.id,
    job.operation,
    job.document_id,
    job.notebook_id,
    job.drive_file_id,
    job.payload,
    job.attempt_count,
    job.lease_expires_at;
end;
$$;

create or replace function public.complete_drive_sync_job(
  target_user_id uuid,
  target_job_id uuid,
  worker_id text,
  target_drive_file_id text,
  target_drive_parent_folder_id text,
  target_drive_modified_time timestamptz,
  target_drive_version text,
  target_drive_md5_checksum text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_operation public.drive_sync_operation;
  claimed_document_id uuid;
  claimed_notebook_id uuid;
  claimed_drive_file_id text;
  changed_count integer;
begin
  if target_user_id is null
    or target_job_id is null
    or worker_id is null
    or char_length(worker_id) not between 1 and 160
    or worker_id ~ '[[:cntrl:]]'
  then
    raise invalid_parameter_value using message = 'Invalid Drive completion lease';
  end if;

  select job.operation, job.document_id, job.notebook_id, job.drive_file_id
  into claimed_operation, claimed_document_id, claimed_notebook_id, claimed_drive_file_id
  from public.drive_sync_jobs as job
  where job.id = target_job_id
    and job.user_id = target_user_id
    and job.status = 'processing'
    and job.lease_owner = worker_id
    and job.lease_expires_at > timezone('utc', now())
  for update;

  if claimed_operation is null then
    return false;
  end if;

  if claimed_operation <> 'delete_permanently' then
    if target_drive_file_id is null
      or char_length(target_drive_file_id) not between 10 and 256
      or target_drive_file_id !~ '^[A-Za-z0-9_-]+$'
      or target_drive_parent_folder_id is null
      or char_length(target_drive_parent_folder_id) not between 10 and 256
      or target_drive_parent_folder_id !~ '^[A-Za-z0-9_-]+$'
      or target_drive_modified_time is null
      or target_drive_version is null
      or target_drive_version !~ '^\d{1,32}$'
      or (
        target_drive_md5_checksum is not null
        and target_drive_md5_checksum !~ '^[0-9a-fA-F]{32}$'
      )
    then
      raise invalid_parameter_value using message = 'Invalid Drive completion metadata';
    end if;
  end if;

  if claimed_operation in ('create_folder', 'rename_folder', 'move_folder') then
    update public.notebooks as notebook
    set
      drive_folder_id = target_drive_file_id,
      drive_modified_time = target_drive_modified_time,
      drive_version = target_drive_version,
      drive_sync_status = 'synced',
      drive_missing = false
    where notebook.id = claimed_notebook_id
      and notebook.user_id = target_user_id;
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then
      raise invalid_parameter_value using message = 'Drive notebook target disappeared';
    end if;
  elsif claimed_operation = 'update_file' then
    update public.documents as document
    set
      drive_file_id = target_drive_file_id,
      drive_parent_folder_id = target_drive_parent_folder_id,
      drive_modified_time = target_drive_modified_time,
      drive_version = target_drive_version,
      drive_md5_checksum = target_drive_md5_checksum,
      physical_state = 'available',
      drive_sync_status = 'synced'
    where document.id = claimed_document_id
      and document.user_id = target_user_id;
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then
      raise invalid_parameter_value using message = 'Drive document target disappeared';
    end if;
  elsif claimed_operation = 'delete_permanently' then
    if claimed_drive_file_id is null then
      raise invalid_parameter_value using message = 'Drive deletion target is missing';
    end if;
  else
    raise invalid_parameter_value using message = 'Unsupported Drive worker operation';
  end if;

  update public.drive_sync_jobs as job
  set
    status = 'synced',
    drive_file_id = coalesce(target_drive_file_id, job.drive_file_id),
    payload = job.payload || jsonb_build_object('outcome', 'synced'),
    lease_owner = null,
    lease_expires_at = null,
    next_retry_at = null,
    last_error_code = null,
    last_error_message = null,
    finished_at = timezone('utc', now())
  where job.id = target_job_id
    and job.user_id = target_user_id
    and job.status = 'processing'
    and job.lease_owner = worker_id;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

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
    status = case when job.attempt_count >= 8 then 'failed' else 'retryable' end,
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

create or replace function public.conflict_drive_sync_job(
  target_user_id uuid,
  target_job_id uuid,
  worker_id text,
  target_kind public.drive_conflict_kind,
  target_local_snapshot jsonb,
  target_remote_snapshot jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_document_id uuid;
  claimed_notebook_id uuid;
  changed_count integer;
begin
  if target_user_id is null
    or target_job_id is null
    or worker_id is null
    or char_length(worker_id) not between 1 and 160
    or worker_id ~ '[[:cntrl:]]'
    or target_kind is null
    or target_local_snapshot is null
    or jsonb_typeof(target_local_snapshot) <> 'object'
    or pg_column_size(target_local_snapshot) > 65536
    or target_remote_snapshot is null
    or jsonb_typeof(target_remote_snapshot) <> 'object'
    or pg_column_size(target_remote_snapshot) > 65536
  then
    raise invalid_parameter_value using message = 'Invalid Drive conflict state';
  end if;

  select job.document_id, job.notebook_id
  into claimed_document_id, claimed_notebook_id
  from public.drive_sync_jobs as job
  where job.id = target_job_id
    and job.user_id = target_user_id
    and job.status = 'processing'
    and job.lease_owner = worker_id
    and job.lease_expires_at > timezone('utc', now())
  for update;

  if claimed_document_id is null and claimed_notebook_id is null then
    return false;
  end if;

  insert into public.drive_conflicts (
    user_id,
    job_id,
    document_id,
    notebook_id,
    kind,
    local_snapshot,
    remote_snapshot
  ) values (
    target_user_id,
    target_job_id,
    claimed_document_id,
    claimed_notebook_id,
    target_kind,
    target_local_snapshot,
    target_remote_snapshot
  )
  on conflict (job_id) where resolved_at is null do nothing;

  update public.drive_sync_jobs as job
  set
    status = 'conflict',
    payload = job.payload || jsonb_build_object('outcome', 'conflict'),
    lease_owner = null,
    lease_expires_at = null,
    next_retry_at = null,
    last_error_code = target_kind::text,
    last_error_message = 'A mudança requer resolução manual.',
    finished_at = timezone('utc', now())
  where job.id = target_job_id
    and job.user_id = target_user_id
    and job.status = 'processing'
    and job.lease_owner = worker_id;

  get diagnostics changed_count = row_count;

  update public.notebooks
  set drive_sync_status = 'conflict'
  where changed_count = 1
    and id = claimed_notebook_id
    and user_id = target_user_id;

  update public.documents
  set drive_sync_status = 'conflict'
  where changed_count = 1
    and id = claimed_document_id
    and user_id = target_user_id;

  return changed_count = 1;
end;
$$;

revoke execute on function public.claim_drive_sync_job_for_user(uuid, text, integer)
  from public, anon, authenticated;
revoke execute on function public.complete_drive_sync_job(
  uuid, uuid, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
revoke execute on function public.retry_drive_sync_job(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.conflict_drive_sync_job(
  uuid, uuid, text, public.drive_conflict_kind, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.claim_drive_sync_job_for_user(uuid, text, integer)
  to service_role;
grant execute on function public.complete_drive_sync_job(
  uuid, uuid, text, text, text, timestamptz, text, text
) to service_role;
grant execute on function public.retry_drive_sync_job(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.conflict_drive_sync_job(
  uuid, uuid, text, public.drive_conflict_kind, jsonb, jsonb
) to service_role;
