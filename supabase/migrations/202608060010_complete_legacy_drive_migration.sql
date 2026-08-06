alter table public.documents
  add column drive_migrated_at timestamptz;

alter table public.documents
  add constraint documents_drive_migration_receipt_check
  check (
    drive_migrated_at is null
    or (
      drive_file_id is not null
      and storage_path is not null
      and drive_sync_status = 'synced'
    )
  );

create index documents_pending_drive_migration_idx
  on public.documents (user_id, created_at)
  where storage_path is not null and drive_file_id is null;

create index documents_drive_fallback_pending_idx
  on public.documents (user_id, drive_migrated_at)
  where drive_migrated_at is not null and storage_path is not null;

create or replace function public.complete_drive_legacy_migration(
  target_document_id uuid,
  expected_storage_path text,
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
  current_storage_path text;
  current_drive_file_id text;
  current_migrated_at timestamptz;
  expected_folder_id text;
  changed_count integer;
begin
  if not public.is_authorized_user() then
    raise insufficient_privilege using message = 'Drive migration is not authorized';
  end if;

  if target_document_id is null
    or expected_storage_path is null
    or char_length(expected_storage_path) not between 1 and 1024
    or expected_storage_path ~ '[[:cntrl:]]'
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
    raise invalid_parameter_value using message = 'Invalid legacy Drive migration input';
  end if;

  select
    document.kind,
    document.notebook_id,
    document.storage_path,
    document.drive_file_id,
    document.drive_migrated_at
  into
    target_kind,
    target_notebook_id,
    current_storage_path,
    current_drive_file_id,
    current_migrated_at
  from public.documents as document
  where document.id = target_document_id
    and document.user_id = auth.uid()
  for update;

  if target_kind is null or current_storage_path is null then
    raise invalid_parameter_value using message = 'Legacy document is not available for migration';
  end if;

  if current_drive_file_id is not null then
    if current_drive_file_id = target_drive_file_id
      and current_storage_path = expected_storage_path
      and current_migrated_at is not null
    then
      return true;
    end if;
    raise invalid_parameter_value using message = 'Legacy document already has a different Drive identity';
  end if;

  if current_storage_path <> expected_storage_path then
    raise invalid_parameter_value using message = 'Legacy Storage path changed during migration';
  end if;

  if target_kind = 'image'
    and target_drive_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
  then
    raise invalid_parameter_value using message = 'Drive migration type does not match document';
  elsif target_kind = 'pdf' and target_drive_mime_type <> 'application/pdf' then
    raise invalid_parameter_value using message = 'Drive migration type does not match document';
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
    raise insufficient_privilege using message = 'Drive migration folder is not authorized';
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
    drive_sync_status = 'synced',
    drive_migrated_at = timezone('utc', now())
  where document.id = target_document_id
    and document.user_id = auth.uid()
    and document.storage_path = expected_storage_path
    and document.drive_file_id is null;

  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

revoke execute on function public.complete_drive_legacy_migration(
  uuid, text, text, text, text, timestamptz, text, text
) from public, anon;
grant execute on function public.complete_drive_legacy_migration(
  uuid, text, text, text, text, timestamptz, text, text
) to authenticated;
