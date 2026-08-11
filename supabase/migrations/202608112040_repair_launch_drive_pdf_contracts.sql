-- Launch-baseline repair after removing pre-launch compatibility.
-- Keep the lease-based public PDF contract while moving its publication implementation
-- behind the private schema, and use the split page_status enum explicitly.

create or replace function public.create_drive_pdf_import(
  target_document_id uuid,
  target_notebook_id uuid,
  document_title text,
  original_filename text,
  target_drive_file_id text,
  target_drive_parent_folder_id text,
  target_drive_mime_type text,
  target_drive_modified_time timestamptz,
  target_drive_version text,
  target_drive_md5_checksum text,
  prepared_sha256 text,
  source_created_at timestamptz,
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
  expected_parent_folder_id text;
  page_count integer;
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
  if char_length(trim(document_title)) not between 1 and 240
    or char_length(original_filename) not between 1 and 512
    or prepared_sha256 !~ '^[0-9a-f]{64}$'
    or prompt_version < 1 or prompt_version > 10000
    or char_length(target_drive_file_id) not between 10 and 256
    or target_drive_file_id !~ '^[A-Za-z0-9_-]+$'
    or char_length(target_drive_parent_folder_id) not between 10 and 256
    or target_drive_parent_folder_id !~ '^[A-Za-z0-9_-]+$'
    or target_drive_mime_type <> 'application/pdf'
    or target_drive_modified_time is null
    or target_drive_version !~ '^\d{1,32}$'
    or (
      target_drive_md5_checksum is not null
      and target_drive_md5_checksum !~ '^[0-9a-fA-F]{32}$'
    )
  then
    raise exception 'invalid Drive PDF metadata' using errcode = '22023';
  end if;

  if target_notebook_id is null then
    select connection.root_folder_id
    into expected_parent_folder_id
    from public.drive_connections as connection
    where connection.user_id = current_user_id
      and connection.status in ('connected', 'syncing');
  else
    select notebook.drive_folder_id
    into expected_parent_folder_id
    from public.notebooks as notebook
    where notebook.id = target_notebook_id
      and notebook.user_id = current_user_id
      and not notebook.drive_missing;
  end if;

  if expected_parent_folder_id is null
    or expected_parent_folder_id <> target_drive_parent_folder_id
  then
    raise exception 'invalid Drive parent folder' using errcode = '42501';
  end if;
  if jsonb_typeof(page_descriptors) <> 'array' then
    raise exception 'invalid PDF page descriptors' using errcode = '22023';
  end if;

  page_count := jsonb_array_length(page_descriptors);
  if page_count < 1 or page_count > 10000 then
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

  if descriptor_count <> page_count
    or distinct_page_count <> page_count
    or minimum_page <> 1
    or maximum_page <> page_count
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
        or temporary_path not like current_user_id::text || '/%'
        or temporary_path !~ '^[A-Za-z0-9_./-]+\.(webp|jpg)$'
        or job_id is null
      then
        raise exception 'invalid OCR page descriptor' using errcode = '22023';
      end if;
      ocr_page_count := ocr_page_count + 1;
    else
      if temporary_path is not null or job_id is not null or native_text is null then
        raise exception 'invalid native page descriptor' using errcode = '22023';
      end if;
      if btrim(native_text) = '' then
        review_page_count := review_page_count + 1;
      end if;
    end if;
  end loop;

  document_state := case
    when ocr_page_count = page_count then 'processing'::public.document_status
    when ocr_page_count > 0 then 'partially_ready'::public.document_status
    when review_page_count > 0 then 'needs_review'::public.document_status
    else 'ready'::public.document_status
  end;

  insert into public.documents (
    id,
    user_id,
    notebook_id,
    title,
    kind,
    original_filename,
    storage_path,
    page_count,
    status,
    sha256,
    source_created_at,
    drive_file_id,
    drive_parent_folder_id,
    drive_mime_type,
    drive_modified_time,
    drive_version,
    drive_md5_checksum,
    physical_state,
    drive_sync_status
  ) values (
    target_document_id,
    current_user_id,
    target_notebook_id,
    trim(document_title),
    'pdf',
    original_filename,
    null,
    page_count,
    document_state,
    prepared_sha256,
    source_created_at,
    target_drive_file_id,
    target_drive_parent_folder_id,
    target_drive_mime_type,
    target_drive_modified_time,
    target_drive_version,
    lower(target_drive_md5_checksum),
    'available',
    'synced'
  );

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
        when needs_ocr then 'pending'::public.page_status
        when btrim(native_text) = '' then 'needs_review'::public.page_status
        else 'ready'::public.page_status
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

  return jsonb_build_object(
    'documentId', target_document_id,
    'pageCount', page_count,
    'ocrPageCount', ocr_page_count,
    'reviewPageCount', review_page_count,
    'status', document_state
  );
end;
$$;

revoke execute on function public.create_drive_pdf_import(
  uuid, uuid, text, text, text, text, text, timestamptz,
  text, text, text, timestamptz, jsonb, integer
) from public, anon;
grant execute on function public.create_drive_pdf_import(
  uuid, uuid, text, text, text, text, text, timestamptz,
  text, text, text, timestamptz, jsonb, integer
) to authenticated;

create or replace function private.finalize_drive_pdf_reference_import(
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
  descriptor jsonb;
  descriptor_key_count integer;
  page_id uuid;
  page_number integer;
  native_text text;
  needs_ocr boolean;
  temporary_path text;
  job_id uuid;
  seen_pages integer[] := array[]::integer[];
  ocr_page_count integer := 0;
  review_page_count integer := 0;
  document_state public.document_status;
  strict_uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
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
  if page_descriptors is null or jsonb_typeof(page_descriptors) <> 'array' then
    raise exception 'invalid PDF page descriptors' using errcode = '22023';
  end if;

  resolved_page_count := jsonb_array_length(page_descriptors);
  if resolved_page_count < 1 or resolved_page_count > 10000 then
    raise exception 'invalid PDF page count' using errcode = '22023';
  end if;

  for descriptor in
    select value from jsonb_array_elements(page_descriptors)
  loop
    if jsonb_typeof(descriptor) <> 'object' then
      raise exception 'invalid PDF page descriptor' using errcode = '22023';
    end if;

    select count(*) into descriptor_key_count from jsonb_object_keys(descriptor);
    if descriptor_key_count <> 6
      or not (descriptor ?& array['id', 'pageNumber', 'nativeText', 'needsOcr', 'temporaryImagePath', 'jobId'])
      or jsonb_typeof(descriptor->'id') <> 'string'
      or (descriptor->>'id') !~ strict_uuid_pattern
      or jsonb_typeof(descriptor->'pageNumber') <> 'number'
      or (descriptor->>'pageNumber') !~ '^[0-9]{1,5}$'
      or jsonb_typeof(descriptor->'needsOcr') <> 'boolean'
    then
      raise exception 'invalid PDF page descriptor' using errcode = '22023';
    end if;

    page_number := (descriptor->>'pageNumber')::integer;
    if page_number < 1
      or page_number > resolved_page_count
      or page_number = any(seen_pages)
    then
      raise exception 'PDF page descriptors must be continuous and unique' using errcode = '22023';
    end if;
    seen_pages := array_append(seen_pages, page_number);

    needs_ocr := (descriptor->>'needsOcr')::boolean;
    if needs_ocr then
      if descriptor->'nativeText' is distinct from 'null'::jsonb
        or jsonb_typeof(descriptor->'temporaryImagePath') <> 'string'
        or jsonb_typeof(descriptor->'jobId') <> 'string'
        or (descriptor->>'jobId') !~ strict_uuid_pattern
      then
        raise exception 'invalid OCR page descriptor' using errcode = '22023';
      end if;

      temporary_path := descriptor->>'temporaryImagePath';
      if temporary_path not in (
        current_user_id::text || '/' || target_document_id::text || '/pages/' || page_number::text || '.webp',
        current_user_id::text || '/' || target_document_id::text || '/pages/' || page_number::text || '.jpg'
      ) then
        raise exception 'invalid OCR page descriptor' using errcode = '22023';
      end if;
      ocr_page_count := ocr_page_count + 1;
    else
      if jsonb_typeof(descriptor->'nativeText') <> 'string'
        or char_length(descriptor->>'nativeText') > 120000
        or descriptor->'temporaryImagePath' is distinct from 'null'::jsonb
        or descriptor->'jobId' is distinct from 'null'::jsonb
      then
        raise exception 'invalid native page descriptor' using errcode = '22023';
      end if;
      if btrim(descriptor->>'nativeText') = '' then
        review_page_count := review_page_count + 1;
      end if;
    end if;
  end loop;

  if cardinality(seen_pages) <> resolved_page_count then
    raise exception 'PDF page descriptors must be continuous and unique' using errcode = '22023';
  end if;

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
      when needs_ocr then descriptor->>'temporaryImagePath'
      else null
    end;
    job_id := case
      when needs_ocr then (descriptor->>'jobId')::uuid
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
        when needs_ocr then 'pending'::public.page_status
        when btrim(native_text) = '' then 'needs_review'::public.page_status
        else 'ready'::public.page_status
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

revoke all on function private.finalize_drive_pdf_reference_import(uuid, jsonb, integer)
from public, anon, authenticated, service_role;

create or replace function public.finalize_drive_pdf_reference_descriptor_attempt(
  target_document_id uuid,
  target_attempt_id uuid,
  prompt_version integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  expected_page_count integer;
  current_expiry timestamptz;
  staged_count integer;
  minimum_page integer;
  maximum_page integer;
  staged_descriptors jsonb;
  publication jsonb;
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_document_id is null
    or target_attempt_id is null
    or prompt_version is null
    or prompt_version < 1
    or prompt_version > 10000 then
    raise exception using errcode = '22023', message = 'Invalid Drive PDF descriptor finalization request';
  end if;

  select descriptor_expected_page_count, descriptor_attempt_expires_at
    into expected_page_count, current_expiry
    from public.drive_pdf_reference_imports
   where document_id = target_document_id
     and user_id = current_user_id
     and status = 'pending_inspection'
     and descriptor_attempt_id = target_attempt_id
   for update;

  if not found
    or expected_page_count is null
    or current_expiry is null
    or current_expiry <= timezone('utc', now()) then
    raise exception using errcode = '55P03', message = 'Drive PDF descriptor attempt lease is not active';
  end if;

  select count(*)::integer, min(page_number), max(page_number)
    into staged_count, minimum_page, maximum_page
    from public.drive_pdf_reference_page_staging
   where document_id = target_document_id
     and user_id = current_user_id
     and attempt_id = target_attempt_id;

  if staged_count <> expected_page_count
    or minimum_page <> 1
    or maximum_page <> expected_page_count then
    raise exception using errcode = '22023', message = 'Drive PDF staged descriptors are incomplete';
  end if;

  select jsonb_agg(descriptor order by page_number)
    into staged_descriptors
    from public.drive_pdf_reference_page_staging
   where document_id = target_document_id
     and user_id = current_user_id
     and attempt_id = target_attempt_id;

  if staged_descriptors is null
    or jsonb_array_length(staged_descriptors) <> expected_page_count then
    raise exception using errcode = '22023', message = 'Drive PDF staged descriptors are incomplete';
  end if;

  select result
    into publication
    from private.finalize_drive_pdf_reference_import(
      target_document_id,
      staged_descriptors,
      prompt_version
    ) as result;

  if not found or publication is null or jsonb_typeof(publication) <> 'object' then
    raise exception using errcode = '55000', message = 'Drive PDF finalization returned no publication';
  end if;

  return publication;
end;
$$;

revoke all on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) from public, anon;
grant execute on function public.finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer) to authenticated, service_role;
