create or replace function public.finalize_staged_drive_pdf_reference_import(
  target_document_id uuid,
  expected_page_count integer,
  prompt_version integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  descriptor_count integer;
  minimum_page_number integer;
  maximum_page_number integer;
  descriptors jsonb;
  finalized record;
  publication jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null
    or expected_page_count is null
    or expected_page_count < 1
    or prompt_version is null
    or prompt_version < 1
    or prompt_version > 10000 then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF staged finalization request';
  end if;

  perform 1
    from public.drive_pdf_reference_imports as reference
    join public.documents as document
      on document.id = reference.document_id
     and document.user_id = reference.user_id
   where reference.document_id = target_document_id
     and reference.user_id = current_user_id
     and reference.status = 'pending_inspection'
     and document.kind = 'pdf'
     and document.status = 'uploading'
     and document.page_count = 0
     and document.storage_path is null
     and document.sha256 is null
   for update of reference;

  if not found then
    raise exception using errcode = '55000', message = 'Drive PDF reference is unavailable for staged finalization';
  end if;

  select
    count(*)::integer,
    min(page_number),
    max(page_number)
    into descriptor_count, minimum_page_number, maximum_page_number
    from public.drive_pdf_reference_page_descriptors
   where document_id = target_document_id
     and user_id = current_user_id;

  if descriptor_count <> expected_page_count
    or minimum_page_number <> 1
    or maximum_page_number <> expected_page_count then
    raise exception using errcode = '22023', message = 'Drive PDF staged descriptors are incomplete';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', page_id::text,
      'pageNumber', page_number,
      'nativeText', to_jsonb(native_text),
      'needsOcr', needs_ocr,
      'temporaryImagePath', to_jsonb(temporary_image_path),
      'jobId', case when job_id is null then 'null'::jsonb else to_jsonb(job_id::text) end
    )
    order by page_number
  )
    into descriptors
    from public.drive_pdf_reference_page_descriptors
   where document_id = target_document_id
     and user_id = current_user_id;

  if descriptors is null or jsonb_array_length(descriptors) <> expected_page_count then
    raise exception using errcode = '22023', message = 'Drive PDF staged descriptors are incomplete';
  end if;

  select result.*
    into finalized
    from public.finalize_drive_pdf_reference_import(
      target_document_id,
      descriptors,
      prompt_version
    ) as result;

  if not found then
    raise exception using errcode = '55000', message = 'Drive PDF finalization returned no publication';
  end if;

  publication := to_jsonb(finalized);
  if publication is null or jsonb_typeof(publication) <> 'object' then
    raise exception using errcode = '55000', message = 'Drive PDF finalization returned no publication';
  end if;

  return publication;
end;
$$;

revoke all on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer) from public;
revoke all on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer) from anon;
grant execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer) to authenticated;
grant execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer) to service_role;
