create or replace function public.get_drive_pdf_reference_identity(
  target_document_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  result jsonb;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'documentId', document.id,
    'driveFileId', document.drive_file_id,
    'driveParentFolderId', document.drive_parent_folder_id,
    'driveMimeType', document.drive_mime_type,
    'driveModifiedTime', document.drive_modified_time,
    'driveVersion', document.drive_version,
    'driveMd5Checksum', document.drive_md5_checksum,
    'sourceSizeBytes', reference.source_size_bytes
  )
  into result
  from public.drive_pdf_reference_imports as reference
  join public.documents as document
    on document.id = reference.document_id
   and document.user_id = reference.user_id
  where reference.document_id = target_document_id
    and reference.user_id = current_user_id
    and document.user_id = current_user_id
    and document.kind = 'pdf'::public.document_kind
    and document.status = 'uploading'::public.document_status
    and document.storage_path is null
    and document.drive_file_id is not null
    and document.drive_parent_folder_id is not null
    and document.drive_mime_type = 'application/pdf'
    and document.drive_modified_time is not null
    and document.drive_version is not null;

  if result is null then
    raise exception 'Drive PDF reference identity is unavailable' using errcode = '55000';
  end if;

  return result;
end;
$$;

revoke execute on function public.get_drive_pdf_reference_identity(uuid) from public, anon;
grant execute on function public.get_drive_pdf_reference_identity(uuid) to authenticated;
