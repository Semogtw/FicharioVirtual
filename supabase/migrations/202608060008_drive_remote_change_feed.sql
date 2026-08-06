create or replace function public.begin_drive_remote_sync(target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resume_token text;
begin
  if target_user_id is null then
    raise invalid_parameter_value using message = 'Invalid Drive sync user';
  end if;

  update public.drive_connections as connection
  set
    status = 'syncing',
    last_sync_started_at = timezone('utc', now()),
    last_error_code = null,
    last_error_message = null
  from public.app_users as app_user
  where connection.user_id = target_user_id
    and app_user.user_id = connection.user_id
    and app_user.is_active
    and connection.root_folder_id is not null
    and coalesce(connection.next_page_token, connection.start_page_token) is not null
  returning coalesce(connection.next_page_token, connection.start_page_token)
  into resume_token;

  return resume_token;
end;
$$;

create or replace function public.apply_drive_remote_change(
  target_user_id uuid,
  target_event_key text,
  target_file_id text,
  target_removed boolean,
  target_file_name text,
  target_mime_type text,
  target_parent_folder_id text,
  target_modified_time timestamptz,
  target_version text,
  target_md5_checksum text,
  target_trashed boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_job_id uuid;
  replay_outcome text;
  target_document_id uuid;
  target_notebook_id uuid;
  target_root_folder_id text;
  destination_notebook_id uuid;
  parent_is_known boolean := false;
  creates_cycle boolean := false;
  local_snapshot jsonb := '{}'::jsonb;
  remote_snapshot jsonb;
begin
  if target_user_id is null
    or target_event_key is null
    or char_length(target_event_key) not between 16 and 240
    or target_event_key ~ '[[:cntrl:]]'
    or target_file_id is null
    or char_length(target_file_id) not between 10 and 256
    or target_file_id !~ '^[A-Za-z0-9_-]+$'
    or target_removed is null
    or target_trashed is null
  then
    raise invalid_parameter_value using message = 'Invalid Drive remote change';
  end if;

  select connection.root_folder_id
  into target_root_folder_id
  from public.drive_connections as connection
  join public.app_users as app_user
    on app_user.user_id = connection.user_id
   and app_user.is_active
  where connection.user_id = target_user_id
    and connection.status = 'syncing';

  if target_root_folder_id is null then
    raise insufficient_privilege using message = 'Drive sync is not active';
  end if;

  insert into public.drive_sync_jobs (
    user_id,
    operation,
    status,
    drive_file_id,
    idempotency_key,
    payload
  ) values (
    target_user_id,
    'apply_remote_change',
    'processing',
    target_file_id,
    target_event_key,
    jsonb_build_object('outcome', 'processing')
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into target_job_id;

  if target_job_id is null then
    select job.payload ->> 'outcome'
    into replay_outcome
    from public.drive_sync_jobs as job
    where job.user_id = target_user_id
      and job.idempotency_key = target_event_key;
    return coalesce(replay_outcome, 'ignored');
  end if;

  select document.id
  into target_document_id
  from public.documents as document
  where document.user_id = target_user_id
    and document.drive_file_id = target_file_id;

  select notebook.id
  into target_notebook_id
  from public.notebooks as notebook
  where notebook.user_id = target_user_id
    and notebook.drive_folder_id = target_file_id;

  remote_snapshot := jsonb_strip_nulls(
    jsonb_build_object(
      'fileId', target_file_id,
      'removed', target_removed,
      'name', target_file_name,
      'mimeType', target_mime_type,
      'parentFolderId', target_parent_folder_id,
      'modifiedTime', target_modified_time,
      'version', target_version,
      'md5Checksum', target_md5_checksum,
      'trashed', target_trashed
    )
  );

  if target_document_id is not null and target_notebook_id is not null then
    update public.drive_sync_jobs
    set
      status = 'conflict',
      document_id = target_document_id,
      notebook_id = target_notebook_id,
      payload = jsonb_build_object('outcome', 'conflict'),
      finished_at = timezone('utc', now())
    where id = target_job_id;

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
      target_document_id,
      target_notebook_id,
      'identity_mismatch',
      '{}'::jsonb,
      remote_snapshot
    )
    on conflict do nothing;
    return 'conflict';
  end if;

  if target_removed or target_trashed then
    if target_document_id is not null then
      update public.documents
      set
        physical_state = 'missing',
        drive_sync_status = 'synced'
      where id = target_document_id
        and user_id = target_user_id;
    elsif target_notebook_id is not null then
      update public.notebooks
      set
        drive_missing = true,
        drive_sync_status = 'synced'
      where id = target_notebook_id
        and user_id = target_user_id;
    else
      update public.drive_sync_jobs
      set
        status = 'synced',
        payload = jsonb_build_object('outcome', 'ignored'),
        finished_at = timezone('utc', now())
      where id = target_job_id;
      return 'ignored';
    end if;

    update public.drive_sync_jobs
    set
      status = 'synced',
      document_id = target_document_id,
      notebook_id = target_notebook_id,
      payload = jsonb_build_object('outcome', 'applied'),
      finished_at = timezone('utc', now())
    where id = target_job_id;
    return 'applied';
  end if;

  if target_file_name is null
    or char_length(btrim(target_file_name)) not between 1 and 512
    or target_file_name ~ '[[:cntrl:]]'
    or target_mime_type is null
    or char_length(target_mime_type) not between 1 and 256
    or target_mime_type ~ '[[:cntrl:]]'
    or target_modified_time is null
    or target_version is null
    or target_version !~ '^\d{1,32}$'
    or (
      target_parent_folder_id is not null
      and (
        char_length(target_parent_folder_id) not between 10 and 256
        or target_parent_folder_id !~ '^[A-Za-z0-9_-]+$'
      )
    )
    or (
      target_md5_checksum is not null
      and target_md5_checksum !~ '^[0-9a-fA-F]{32}$'
    )
  then
    raise invalid_parameter_value using message = 'Invalid Drive remote file metadata';
  end if;

  if target_document_id is null and target_notebook_id is null then
    update public.drive_sync_jobs
    set
      status = 'synced',
      payload = jsonb_build_object('outcome', 'ignored'),
      finished_at = timezone('utc', now())
    where id = target_job_id;
    return 'ignored';
  end if;

  if target_parent_folder_id = target_root_folder_id then
    destination_notebook_id := null;
    parent_is_known := true;
  elsif target_parent_folder_id is not null then
    select notebook.id
    into destination_notebook_id
    from public.notebooks as notebook
    where notebook.user_id = target_user_id
      and notebook.drive_folder_id = target_parent_folder_id
      and not notebook.drive_missing;
    parent_is_known := destination_notebook_id is not null;
  end if;

  if target_document_id is not null then
    select jsonb_build_object(
      'documentId', document.id,
      'notebookId', document.notebook_id,
      'physicalState', document.physical_state,
      'driveVersion', document.drive_version
    )
    into local_snapshot
    from public.documents as document
    where document.id = target_document_id;

    if not parent_is_known
      or target_mime_type = 'application/vnd.google-apps.folder'
    then
      update public.drive_sync_jobs
      set
        status = 'conflict',
        document_id = target_document_id,
        payload = jsonb_build_object('outcome', 'conflict'),
        finished_at = timezone('utc', now())
      where id = target_job_id;

      insert into public.drive_conflicts (
        user_id,
        job_id,
        document_id,
        kind,
        local_snapshot,
        remote_snapshot
      ) values (
        target_user_id,
        target_job_id,
        target_document_id,
        case
          when target_mime_type = 'application/vnd.google-apps.folder'
            then 'identity_mismatch'::public.drive_conflict_kind
          else 'ambiguous_order'::public.drive_conflict_kind
        end,
        local_snapshot,
        remote_snapshot
      )
      on conflict do nothing;
      return 'conflict';
    end if;

    update public.documents
    set
      notebook_id = destination_notebook_id,
      drive_parent_folder_id = target_parent_folder_id,
      drive_mime_type = target_mime_type,
      drive_modified_time = target_modified_time,
      drive_version = target_version,
      drive_md5_checksum = target_md5_checksum,
      physical_state = 'available',
      drive_sync_status = 'synced'
    where id = target_document_id
      and user_id = target_user_id;

    update public.drive_sync_jobs
    set
      status = 'synced',
      document_id = target_document_id,
      payload = jsonb_build_object('outcome', 'applied'),
      finished_at = timezone('utc', now())
    where id = target_job_id;
    return 'applied';
  end if;

  select jsonb_build_object(
    'notebookId', notebook.id,
    'parentNotebookId', notebook.parent_notebook_id,
    'driveVersion', notebook.drive_version,
    'driveMissing', notebook.drive_missing
  )
  into local_snapshot
  from public.notebooks as notebook
  where notebook.id = target_notebook_id;

  if target_mime_type <> 'application/vnd.google-apps.folder' or not parent_is_known then
    update public.drive_sync_jobs
    set
      status = 'conflict',
      notebook_id = target_notebook_id,
      payload = jsonb_build_object('outcome', 'conflict'),
      finished_at = timezone('utc', now())
    where id = target_job_id;

    insert into public.drive_conflicts (
      user_id,
      job_id,
      notebook_id,
      kind,
      local_snapshot,
      remote_snapshot
    ) values (
      target_user_id,
      target_job_id,
      target_notebook_id,
      case
        when target_mime_type <> 'application/vnd.google-apps.folder'
          then 'identity_mismatch'::public.drive_conflict_kind
        else 'ambiguous_order'::public.drive_conflict_kind
      end,
      local_snapshot,
      remote_snapshot
    )
    on conflict do nothing;
    return 'conflict';
  end if;

  if destination_notebook_id is not null then
    with recursive ancestors as (
      select notebook.id, notebook.parent_notebook_id
      from public.notebooks as notebook
      where notebook.id = destination_notebook_id
        and notebook.user_id = target_user_id
      union all
      select parent.id, parent.parent_notebook_id
      from public.notebooks as parent
      join ancestors on ancestors.parent_notebook_id = parent.id
      where parent.user_id = target_user_id
    )
    select exists (
      select 1 from ancestors where id = target_notebook_id
    ) into creates_cycle;
  end if;

  if creates_cycle then
    update public.drive_sync_jobs
    set
      status = 'conflict',
      notebook_id = target_notebook_id,
      payload = jsonb_build_object('outcome', 'conflict'),
      finished_at = timezone('utc', now())
    where id = target_job_id;

    insert into public.drive_conflicts (
      user_id,
      job_id,
      notebook_id,
      kind,
      local_snapshot,
      remote_snapshot
    ) values (
      target_user_id,
      target_job_id,
      target_notebook_id,
      'ambiguous_order',
      local_snapshot,
      remote_snapshot
    )
    on conflict do nothing;
    return 'conflict';
  end if;

  update public.notebooks
  set
    name = btrim(target_file_name),
    parent_notebook_id = destination_notebook_id,
    drive_modified_time = target_modified_time,
    drive_version = target_version,
    drive_sync_status = 'synced',
    drive_missing = false
  where id = target_notebook_id
    and user_id = target_user_id;

  update public.drive_sync_jobs
  set
    status = 'synced',
    notebook_id = target_notebook_id,
    payload = jsonb_build_object('outcome', 'applied'),
    finished_at = timezone('utc', now())
  where id = target_job_id;
  return 'applied';
end;
$$;

create or replace function public.persist_drive_change_checkpoint(
  target_user_id uuid,
  expected_page_token text,
  target_page_token text,
  completed boolean
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
    or expected_page_token is null
    or char_length(expected_page_token) not between 1 and 4096
    or expected_page_token ~ '[[:cntrl:]]'
    or target_page_token is null
    or char_length(target_page_token) not between 1 and 4096
    or target_page_token ~ '[[:cntrl:]]'
    or completed is null
  then
    raise invalid_parameter_value using message = 'Invalid Drive checkpoint';
  end if;

  update public.drive_connections as connection
  set
    start_page_token = case when completed then target_page_token else connection.start_page_token end,
    next_page_token = case when completed then null else target_page_token end,
    status = case
      when completed then 'connected'::public.drive_connection_status
      else 'syncing'::public.drive_connection_status
    end,
    last_sync_completed_at = case
      when completed then timezone('utc', now())
      else connection.last_sync_completed_at
    end,
    last_error_code = null,
    last_error_message = null
  where connection.user_id = target_user_id
    and connection.status = 'syncing'
    and coalesce(connection.next_page_token, connection.start_page_token) = expected_page_token;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

create or replace function public.fail_drive_remote_sync(
  target_user_id uuid,
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
    or target_error_code is null
    or target_error_code !~ '^[a-z0-9_]{1,64}$'
    or target_error_message is null
    or char_length(target_error_message) not between 1 and 500
    or target_error_message ~ '[[:cntrl:]]'
  then
    raise invalid_parameter_value using message = 'Invalid Drive sync failure';
  end if;

  update public.drive_connections
  set
    status = 'error',
    last_error_code = target_error_code,
    last_error_message = target_error_message
  where user_id = target_user_id;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke execute on function public.begin_drive_remote_sync(uuid)
  from public, anon, authenticated;
revoke execute on function public.apply_drive_remote_change(
  uuid, text, text, boolean, text, text, text, timestamptz, text, text, boolean
) from public, anon, authenticated;
revoke execute on function public.persist_drive_change_checkpoint(uuid, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.fail_drive_remote_sync(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.begin_drive_remote_sync(uuid) to service_role;
grant execute on function public.apply_drive_remote_change(
  uuid, text, text, boolean, text, text, text, timestamptz, text, text, boolean
) to service_role;
grant execute on function public.persist_drive_change_checkpoint(uuid, text, text, boolean)
  to service_role;
grant execute on function public.fail_drive_remote_sync(uuid, text, text)
  to service_role;
