create or replace function public.finalize_drive_pdf_reference_import(
  target_document_id uuid,
  page_descriptors jsonb,
  prompt_version integer default 1
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  staged_status text;
  staged_drive_file_id text;
  staged_document_status public.document_status;
  staged_document_kind public.document_kind;
  staged_storage_path text;
  resolved_page_count integer;
  descriptor_count integer;
  distinct_page_count integer;
  minimum_page integer;
  maximum_page integer;
  ocr_page_count integer := 0;
  review_page_count integer := 0;
  descriptor jsonb;
  page_id uuid;
  page_number integer;
  native_text text;
  needs_ocr boolean;
  temporary_path text;
  job_id uuid;
  document_state public.document_status;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if prompt_version is null or prompt_version < 1 or prompt_version > 10000 then
    raise exception 'invalid PDF prompt version' using errcode = '22023';
  end if;

  select reference.status, document.drive_file_id, document.status, document.kind, document.storage_path
  into staged_status, staged_drive_file_id, staged_document_status, staged_document_kind, staged_storage_path
  from public.drive_pdf_reference_imports as reference
  join public.documents as document
    on document.id = reference.document_id
   and document.user_id = reference.user_id
  where reference.document_id = target_document_id
    and reference.user_id = current_user_id
  for update of reference, document;

  if not found then
    raise exception 'Drive PDF reference is not pending' using errcode = '55000';
  end if;
  if staged_status not in ('pending_inspection', 'inspecting', 'ready_to_finalize')
    or staged_drive_file_id is null
    or staged_document_status <> 'uploading'::public.document_status
    or staged_document_kind <> 'pdf'::public.document_kind
    or staged_storage_path is not null
  then
    raise exception 'Drive PDF reference is not finalizable' using errcode = '55000';
  end if;
  if jsonb_typeof(page_descriptors) <> 'array' then
    raise exception 'invalid PDF page descriptors' using errcode = '22023';
  end if;

  resolved_page_count := jsonb_array_length(page_descriptors);
  if resolved_page_count < 1 or resolved_page_count > 10000 then
    raise exception 'invalid PDF page count' using errcode = '22023';
  end if;

  select
    count(*),
    count(distinct (value->>'pageNumber')::integer),
    min((value->>'pageNumber')::integer),
    max((value->>'pageNumber')::integer)
  into descriptor_count, distinct_page_count, minimum_page, maximum_page
  from jsonb_array_elements(page_descriptors)
  where jsonb_typeof(value) = 'object'
    and value ?& array['id', 'pageNumber', 'nativeText', 'needsOcr', 'temporaryImagePath', 'jobId']
    and (value->>'id') ~ '^[0-9a-fA-F-]{36}$'
    and (value->>'pageNumber') ~ '^[0-9]+$'
    and jsonb_typeof(value->'needsOcr') = 'boolean';

  if descriptor_count <> resolved_page_count
    or distinct_page_count <> resolved_page_count
    or minimum_page <> 1
    or maximum_page <> resolved_page_count
  then
    raise exception 'PDF page descriptors must be continuous and unique' using errcode = '22023';
  end if;

  for descriptor in
    select value from jsonb_array_elements(page_descriptors)
    order by (value->>'pageNumber')::integer
  loop
    page_id := (descriptor->>'id')::uuid;
    page_number := (descriptor->>'pageNumber')::integer;
    native_text := case
      when jsonb_typeof(descriptor->'nativeText') = 'string' then descriptor->>'nativeText'
      when descriptor->'nativeText' = 'null'::jsonb then null
      else null
    end;
    needs_ocr := (descriptor->>'needsOcr')::boolean;
    temporary_path := case
      when jsonb_typeof(descriptor->'temporaryImagePath') = 'string'
        then descriptor->>'temporaryImagePath'
      else null
    end;
    job_id := case
      when jsonb_typeof(descriptor->'jobId') = 'string'
        and (descriptor->>'jobId') ~ '^[0-9a-fA-F-]{36}$'
        then (descriptor->>'jobId')::uuid
      else null
    end;

    if needs_ocr then
      if native_text is not null
        or temporary_path is null
        or temporary_path not like current_user_id::text || '/' || target_document_id::text || '/pages/%'
        or temporary_path !~ '^[A-Za-z0-9_./-]+\.(webp|jpg)$'
        or job_id is null
      then
        raise exception 'invalid OCR page descriptor' using errcode = '22023';
      end if;
      ocr_page_count := ocr_page_count + 1;
    else
      if temporary_path is not null
        or job_id is not null
        or native_text is null
        or char_length(native_text) > 120000
      then
        raise exception 'invalid native page descriptor' using errcode = '22023';
      end if;
      if btrim(native_text) = '' then
        review_page_count := review_page_count + 1;
      end if;
    end if;
  end loop;

  document_state := case
    when ocr_page_count = resolved_page_count then 'processing'::public.document_status
    when ocr_page_count > 0 then 'partially_ready'::public.document_status
    when review_page_count > 0 then 'needs_review'::public.document_status
    else 'ready'::public.document_status
  end;

  update public.documents
  set page_count = resolved_page_count,
      status = document_state
  where id = target_document_id
    and user_id = current_user_id;

  if not found then
    raise exception 'Drive PDF reference document disappeared' using errcode = '55000';
  end if;

  for descriptor in
    select value from jsonb_array_elements(page_descriptors)
    order by (value->>'pageNumber')::integer
  loop
    page_id := (descriptor->>'id')::uuid;
    page_number := (descriptor->>'pageNumber')::integer;
    native_text := case
      when jsonb_typeof(descriptor->'nativeText') = 'string' then descriptor->>'nativeText'
      else null
    end;
    needs_ocr := (descriptor->>'needsOcr')::boolean;
    temporary_path := case
      when jsonb_typeof(descriptor->'temporaryImagePath') = 'string'
        then descriptor->>'temporaryImagePath'
      else null
    end;
    job_id := case
      when jsonb_typeof(descriptor->'jobId') = 'string'
        then (descriptor->>'jobId')::uuid
      else null
    end;

    insert into public.pages (
      id,
      user_id,
      document_id,
      page_number,
      native_text,
      extraction_source,
      temporary_image_path,
      warnings,
      status
    ) values (
      page_id,
      current_user_id,
      target_document_id,
      page_number,
      native_text,
      case when needs_ocr then null else 'native_pdf'::public.extraction_source end,
      temporary_path,
      case
        when not needs_ocr and btrim(native_text) = '' then
          jsonb_build_array(jsonb_build_object(
            'code', 'native_text_missing',
            'message', 'A página não recebeu texto nativo nem foi classificada para OCR.'
          ))
        else '[]'::jsonb
      end,
      case
        when needs_ocr then 'pending'::public.processing_status
        when btrim(native_text) = '' then 'needs_review'::public.processing_status
        else 'ready'::public.processing_status
      end
    );

    if needs_ocr then
      insert into public.ocr_jobs (
        id,
        user_id,
        page_id,
        provider,
        prompt_version,
        status,
        idempotency_key
      ) values (
        job_id,
        current_user_id,
        page_id,
        'gemini',
        prompt_version,
        'pending',
        'ocr:' || page_id::text || ':v' || prompt_version::text
      );
    end if;
  end loop;

  delete from public.drive_pdf_reference_imports
  where document_id = target_document_id
    and user_id = current_user_id;

  return jsonb_build_object(
    'documentId', target_document_id,
    'pageCount', resolved_page_count,
    'ocrPageCount', ocr_page_count,
    'reviewPageCount', review_page_count,
    'status', document_state
  );
end;
$$;

revoke execute on function public.finalize_drive_pdf_reference_import(uuid, jsonb, integer)
from public, anon;
grant execute on function public.finalize_drive_pdf_reference_import(uuid, jsonb, integer)
to authenticated;
