alter table public.drive_connections
  drop constraint if exists drive_connections_root_folder_id_check;

alter table public.drive_connections
  add constraint drive_connections_root_folder_id_check
  check (
    root_folder_id is null
    or (
      char_length(root_folder_id) between 10 and 256
      and root_folder_id ~ '^[A-Za-z0-9_-]+$'
    )
  );

alter table public.notebooks
  drop constraint if exists notebooks_drive_folder_id_format;

alter table public.notebooks
  add constraint notebooks_drive_folder_id_format
  check (
    drive_folder_id is null
    or (
      char_length(drive_folder_id) between 10 and 256
      and drive_folder_id ~ '^[A-Za-z0-9_-]+$'
    )
  );

alter table public.documents
  drop constraint if exists documents_drive_file_id_format,
  drop constraint if exists documents_drive_parent_folder_id_format;

alter table public.documents
  add constraint documents_drive_file_id_format
  check (
    drive_file_id is null
    or (
      char_length(drive_file_id) between 10 and 256
      and drive_file_id ~ '^[A-Za-z0-9_-]+$'
    )
  ),
  add constraint documents_drive_parent_folder_id_format
  check (
    drive_parent_folder_id is null
    or (
      char_length(drive_parent_folder_id) between 10 and 256
      and drive_parent_folder_id ~ '^[A-Za-z0-9_-]+$'
    )
  );

alter table public.drive_sync_jobs
  drop constraint if exists drive_sync_jobs_drive_file_id_check;

alter table public.drive_sync_jobs
  add constraint drive_sync_jobs_drive_file_id_check
  check (
    drive_file_id is null
    or (
      char_length(drive_file_id) between 10 and 256
      and drive_file_id ~ '^[A-Za-z0-9_-]+$'
    )
  );

create or replace function public.mark_drive_file_missing(target_drive_file_id text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  result_id uuid;
begin
  if not public.is_authorized_user() then
    raise insufficient_privilege using message = 'Drive access is not authorized';
  end if;

  if target_drive_file_id is null
    or char_length(target_drive_file_id) not between 10 and 256
    or target_drive_file_id !~ '^[A-Za-z0-9_-]+$'
  then
    raise invalid_parameter_value using message = 'Invalid Drive file identifier';
  end if;

  update public.documents as document
  set
    physical_state = 'missing',
    drive_sync_status = 'synced'
  where document.user_id = auth.uid()
    and document.drive_file_id = target_drive_file_id
  returning document.id into result_id;

  if result_id is null then
    select document.id
    into result_id
    from public.documents as document
    where document.user_id = auth.uid()
      and document.drive_file_id = target_drive_file_id;
  end if;

  return result_id;
end;
$$;

create or replace function public.reconnect_drive_file(
  target_document_id uuid,
  target_drive_file_id text,
  target_modified_time timestamptz,
  target_version text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if not public.is_authorized_user() then
    raise insufficient_privilege using message = 'Drive access is not authorized';
  end if;

  if target_drive_file_id is null
    or char_length(target_drive_file_id) not between 10 and 256
    or target_drive_file_id !~ '^[A-Za-z0-9_-]+$'
    or target_version is null
    or target_version !~ '^\d{1,32}$'
  then
    raise invalid_parameter_value using message = 'Invalid Drive reconnection input';
  end if;

  update public.documents as document
  set
    physical_state = 'available',
    drive_modified_time = target_modified_time,
    drive_version = target_version,
    drive_sync_status = 'synced'
  where document.id = target_document_id
    and document.user_id = auth.uid()
    and document.drive_file_id = target_drive_file_id;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke all on function public.mark_drive_file_missing(text) from public, anon;
revoke all on function public.reconnect_drive_file(uuid, text, timestamptz, text)
  from public, anon;
grant execute on function public.mark_drive_file_missing(text) to authenticated;
grant execute on function public.reconnect_drive_file(uuid, text, timestamptz, text)
  to authenticated;
