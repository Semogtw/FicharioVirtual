create or replace function public.validate_drive_pdf_reference_staging()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if new.user_id <> current_user_id
    or new.document_id is null
    or new.source_size_bytes is null
    or new.source_size_bytes < 1
    or new.source_size_bytes > 9007199254740991
    or new.source_modified_at is null
    or new.status <> 'pending_inspection'
    or new.last_error_code is not null
  then
    raise exception 'invalid Drive PDF reference staging' using errcode = '22023';
  end if;

  perform 1
  from public.documents as document
  where document.id = new.document_id
    and document.user_id = current_user_id
    and document.kind = 'pdf'::public.document_kind
    and document.status = 'uploading'::public.document_status
    and document.page_count = 0
    and document.storage_path is null
    and document.sha256 is null
    and document.drive_file_id ~ '^[A-Za-z0-9_-]{10,256}$'
    and document.drive_parent_folder_id ~ '^[A-Za-z0-9_-]{10,256}$'
    and document.drive_mime_type = 'application/pdf'
    and document.drive_modified_time is not null
    and document.drive_version ~ '^[0-9]{1,32}$'
    and (
      document.drive_md5_checksum is null
      or document.drive_md5_checksum ~ '^[0-9a-fA-F]{32}$'
    );

  if not found then
    raise exception 'invalid Drive PDF reference placeholder' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_drive_pdf_reference_staging() from public, anon;
grant execute on function public.validate_drive_pdf_reference_staging() to authenticated;

drop trigger if exists validate_drive_pdf_reference_staging_before_insert
on public.drive_pdf_reference_imports;

create trigger validate_drive_pdf_reference_staging_before_insert
before insert on public.drive_pdf_reference_imports
for each row
execute function public.validate_drive_pdf_reference_staging();
