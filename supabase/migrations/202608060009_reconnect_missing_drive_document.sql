create or replace function public.reconnect_missing_drive_document(
  target_document_id uuid,
  target_drive_file_id text,
  target_drive_parent_folder_id text,
  target_drive_mime_type text,
  target_drive_modified_time timestamptz,
  target_drive_version text,
  target_drive_md5_checksum text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  target_kind public.document_kind;
  target_notebook_id uuid;
  target_physical_state public.drive_physical_state;
  expected_folder_id text;
  changed_count integer;
begin
  if not public.is_authorized_user() then
    raise insufficient_privilege using message = 'Drive access is not authorized';
  end if;

  if target_document_id is null
    or target_drive_file_id is null
    or char_length(target_drive_file_id) not between 10 and 256
    or target_drive_file_id !~ '^[A-Za-z0-9_-]+$'
    or target_drive_parent_folder_id is null
    or char_length(target_drive_parent_folder_id) not between 10 and 256
    or target_drive_parent_folder_id !~ '^[A-Za-z0-9_-]+$'
    or target_drive_mime_type is null
    or char_length(target_drive_mime_type) not between 1 and 256
    or target_drive_mime_type ~ '[[:cntrl:]]'
    or target_drive_modified_time is null
    or target_drive_version is null
    or target_drive_version !~ '^\d{1,32}$'
    or (
      target_drive_md5_checksum is not null
      and target_drive_md5_checksum !~ '^[0-9a-fA-F]{32}$'
    )
  then
    raise invalid_parameter_value using message = 'Invalid Drive reconnection input';
  end if;

  select document.kind, document.notebook_id, document.physical_state
  into target_kind, target_notebook_id, target_physical_state
  from public.documents as document
  where document.id = target_document_id
    and document.user_id = auth.uid()
  for update;

  if target_kind is null or target_physical_state <> 'missing' then
    raise invalid_parameter_value using message = 'Document is not available for reconnection';
  end if;

  if target_kind = 'image'
    and target_drive_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
  then
    raise invalid_parameter_value using message = 'Drive replacement type does not match document';
  elsif target_kind = 'pdf' and target_drive_mime_type <> 'application/pdf' then
    raise invalid_parameter_value using message = 'Drive replacement type does not match document';
  end if;

  if target_notebook_id is null then
    select connection.root_folder_id
    into expected_folder_id
    from public.drive_connections as connection
    where connection.user_id = auth.uid()
      and connection.status in ('connected', 'syncing', 'error');
  else
    select notebook.drive_folder_id
    into expected_folder_id
    from public.notebooks as notebook
    where notebook.id = target_notebook_id
      and notebook.user_id = auth.uid()
      and not notebook.drive_missing;
  end if;

  if expected_folder_id is null or target_drive_parent_folder_id <> expected_folder_id then
    raise insufficient_privilege using message = 'Drive replacement folder is not authorized';
  end if;

  update public.documents as document
  set
    drive_file_id = target_drive_file_id,
    drive_parent_folder_id = target_drive_parent_folder_id,
    drive_mime_type = target_drive_mime_type,
    drive_modified_time = target_drive_modified_time,
    drive_version = target_drive_version,
    drive_md5_checksum = target_drive_md5_checksum,
    physical_state = 'available',
    drive_sync_status = 'synced'
  where document.id = target_document_id
    and document.user_id = auth.uid()
    and document.physical_state = 'missing';

  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    return false;
  end if;

  update public.drive_conflicts as conflict
  set
    resolution = 'reconnected_original',
    resolved_at = timezone('utc', now())
  where conflict.user_id = auth.uid()
    and conflict.document_id = target_document_id
    and conflict.resolved_at is null;

  return true;
end;
$$;

revoke execute on function public.reconnect_missing_drive_document(
  uuid, text, text, text, timestamptz, text, text
) from public, anon;
grant execute on function public.reconnect_missing_drive_document(
  uuid, text, text, text, timestamptz, text, text
) to authenticated;
