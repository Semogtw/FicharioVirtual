create or replace function public.resolve_drive_conflict(
  target_conflict_id uuid,
  target_resolution text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  conflict_job_id uuid;
  conflict_document_id uuid;
  conflict_notebook_id uuid;
  conflict_kind public.drive_conflict_kind;
  existing_resolution text;
  existing_resolved_at timestamptz;
  document_drive_file_id text;
  document_notebook_id uuid;
  notebook_drive_folder_id text;
  notebook_name text;
  notebook_parent_id uuid;
begin
  if not public.is_authorized_user() then
    raise insufficient_privilege using message = 'Drive conflict resolution is not authorized';
  end if;

  if target_conflict_id is null
    or target_resolution not in ('retry_local', 'mark_missing')
  then
    raise invalid_parameter_value using message = 'Invalid Drive conflict resolution';
  end if;

  select
    conflict.job_id,
    conflict.document_id,
    conflict.notebook_id,
    conflict.kind,
    conflict.resolution,
    conflict.resolved_at
  into
    conflict_job_id,
    conflict_document_id,
    conflict_notebook_id,
    conflict_kind,
    existing_resolution,
    existing_resolved_at
  from public.drive_conflicts as conflict
  where conflict.id = target_conflict_id
    and conflict.user_id = auth.uid()
  for update;

  if conflict_job_id is null then
    return false;
  end if;

  if existing_resolved_at is not null then
    return existing_resolution = target_resolution;
  end if;

  if target_resolution = 'mark_missing' then
    if conflict_document_id is null
      or conflict_kind <> 'remote_deleted_local_changed'
    then
      raise invalid_parameter_value using message = 'Only a removed document original can be marked missing';
    end if;

    update public.documents as document
    set
      physical_state = 'missing',
      drive_sync_status = 'synced'
    where document.id = conflict_document_id
      and document.user_id = auth.uid();

    if not found then
      raise invalid_parameter_value using message = 'Drive conflict document disappeared';
    end if;

    update public.drive_sync_jobs as job
    set
      status = 'synced',
      payload = job.payload || jsonb_build_object('outcome', 'accepted_missing'),
      lease_owner = null,
      lease_expires_at = null,
      next_retry_at = null,
      last_error_code = null,
      last_error_message = null,
      finished_at = timezone('utc', now())
    where job.id = conflict_job_id
      and job.user_id = auth.uid();
  elsif conflict_document_id is not null then
    select document.drive_file_id, document.notebook_id
    into document_drive_file_id, document_notebook_id
    from public.documents as document
    where document.id = conflict_document_id
      and document.user_id = auth.uid()
    for update;

    if document_drive_file_id is null then
      raise invalid_parameter_value using message = 'Drive conflict document has no physical identity';
    end if;

    insert into public.drive_sync_jobs (
      user_id,
      operation,
      status,
      document_id,
      drive_file_id,
      idempotency_key,
      payload
    ) values (
      auth.uid(),
      'update_file',
      'pending',
      conflict_document_id,
      document_drive_file_id,
      'resolution:' || target_conflict_id::text || ':update_file',
      jsonb_strip_nulls(jsonb_build_object('notebookId', document_notebook_id))
    )
    on conflict (user_id, idempotency_key) do nothing;

    update public.documents
    set drive_sync_status = 'pending'
    where id = conflict_document_id
      and user_id = auth.uid();

    update public.drive_sync_jobs as job
    set
      status = 'cancelled',
      payload = job.payload || jsonb_build_object('outcome', 'superseded_by_local_retry'),
      lease_owner = null,
      lease_expires_at = null,
      next_retry_at = null,
      finished_at = timezone('utc', now())
    where job.id = conflict_job_id
      and job.user_id = auth.uid();
  else
    select
      notebook.drive_folder_id,
      notebook.name,
      notebook.parent_notebook_id
    into
      notebook_drive_folder_id,
      notebook_name,
      notebook_parent_id
    from public.notebooks as notebook
    where notebook.id = conflict_notebook_id
      and notebook.user_id = auth.uid()
    for update;

    if notebook_name is null then
      raise invalid_parameter_value using message = 'Drive conflict notebook disappeared';
    end if;

    if notebook_drive_folder_id is null then
      insert into public.drive_sync_jobs (
        user_id,
        operation,
        status,
        notebook_id,
        idempotency_key,
        payload
      )
      select
        auth.uid(),
        'create_folder',
        'pending',
        conflict_notebook_id,
        'resolution:' || target_conflict_id::text || ':create_folder',
        jsonb_strip_nulls(
          jsonb_build_object(
            'name', notebook_name,
            'parentNotebookId', notebook_parent_id
          )
        )
      where not exists (
        select 1
        from public.drive_sync_jobs as active_job
        where active_job.user_id = auth.uid()
          and active_job.notebook_id = conflict_notebook_id
          and active_job.operation = 'create_folder'
          and active_job.status in ('pending', 'processing', 'retryable')
      )
      on conflict (user_id, idempotency_key) do nothing;
    else
      insert into public.drive_sync_jobs (
        user_id,
        operation,
        status,
        notebook_id,
        drive_file_id,
        idempotency_key,
        payload
      ) values
      (
        auth.uid(),
        'rename_folder',
        'pending',
        conflict_notebook_id,
        notebook_drive_folder_id,
        'resolution:' || target_conflict_id::text || ':rename_folder',
        jsonb_build_object('name', notebook_name)
      ),
      (
        auth.uid(),
        'move_folder',
        'pending',
        conflict_notebook_id,
        notebook_drive_folder_id,
        'resolution:' || target_conflict_id::text || ':move_folder',
        jsonb_strip_nulls(jsonb_build_object('parentNotebookId', notebook_parent_id))
      )
      on conflict (user_id, idempotency_key) do nothing;
    end if;

    update public.notebooks
    set drive_sync_status = 'pending'
    where id = conflict_notebook_id
      and user_id = auth.uid();

    update public.drive_sync_jobs as job
    set
      status = 'cancelled',
      payload = job.payload || jsonb_build_object('outcome', 'superseded_by_local_retry'),
      lease_owner = null,
      lease_expires_at = null,
      next_retry_at = null,
      finished_at = timezone('utc', now())
    where job.id = conflict_job_id
      and job.user_id = auth.uid();
  end if;

  update public.drive_conflicts as conflict
  set
    resolution = target_resolution,
    resolved_at = timezone('utc', now())
  where conflict.id = target_conflict_id
    and conflict.user_id = auth.uid()
    and conflict.resolved_at is null;

  return true;
end;
$$;

revoke execute on function public.resolve_drive_conflict(uuid, text)
  from public, anon;
grant execute on function public.resolve_drive_conflict(uuid, text)
  to authenticated;
