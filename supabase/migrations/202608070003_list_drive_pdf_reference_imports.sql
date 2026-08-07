create or replace function public.list_drive_pdf_reference_imports()
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'documentId', reference.document_id,
        'driveFileId', document.drive_file_id,
        'sourceSizeBytes', reference.source_size_bytes,
        'status', reference.status,
        'title', document.title,
        'sourceModifiedAt', reference.source_modified_at,
        'updatedAt', reference.updated_at
      )
      order by reference.updated_at asc, reference.document_id asc
    ),
    '[]'::jsonb
  )
  into result
  from public.drive_pdf_reference_imports as reference
  join public.documents as document
    on document.id = reference.document_id
   and document.user_id = reference.user_id
  where reference.user_id = current_user_id
    and document.user_id = current_user_id
    and document.kind = 'pdf'::public.document_kind
    and document.drive_file_id is not null
    and document.storage_path is null
    and document.status = 'uploading'::public.document_status;

  return result;
end;
$$;

revoke execute on function public.list_drive_pdf_reference_imports() from public, anon;
grant execute on function public.list_drive_pdf_reference_imports() to authenticated;
