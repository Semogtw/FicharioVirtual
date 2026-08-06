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
    or target_drive_file_id !~ '^[A-Za-z0-9_-]{10,256}$'
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

revoke all on function public.reconnect_drive_file(uuid, text, timestamptz, text)
  from public, anon;
grant execute on function public.reconnect_drive_file(uuid, text, timestamptz, text)
  to authenticated;
