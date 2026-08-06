create or replace function public.create_drive_image_import(
  target_document_id uuid,
  target_page_id uuid,
  target_job_id uuid,
  target_notebook_id uuid,
  document_title text,
  original_filename text,
  target_drive_file_id text,
  target_drive_parent_folder_id text,
  target_drive_mime_type text,
  target_drive_modified_time timestamptz,
  target_drive_version text,
  target_drive_md5_checksum text,
  thumbnail_storage_path text,
  prepared_sha256 text,
  source_created_at timestamptz default null,
  prompt_version integer default 1
)
returns table (
  document_id uuid,
  page_id uuid,
  ocr_job_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  expected_parent_folder_id text;
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
    or char_length(target_drive_mime_type) not between 1 and 256
    or target_drive_mime_type not like 'image/%'
    or target_drive_modified_time is null
    or target_drive_version !~ '^\d{1,32}$'
    or (
      target_drive_md5_checksum is not null
      and target_drive_md5_checksum !~ '^[0-9a-fA-F]{32}$'
    )
  then
    raise exception 'invalid Drive image metadata' using errcode = '22023';
  end if;
  if thumbnail_storage_path not like current_user_id::text || '/%'
    or thumbnail_storage_path !~ '^[A-Za-z0-9_./-]+\.(webp|jpg)$'
  then
    raise exception 'invalid thumbnail ownership' using errcode = '42501';
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

  insert into public.documents (
    id,
    user_id,
    notebook_id,
    title,
    kind,
    original_filename,
    storage_path,
    thumbnail_path,
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
    'image',
    original_filename,
    null,
    thumbnail_storage_path,
    1,
    'pending',
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

  insert into public.pages (
    id,
    user_id,
    document_id,
    page_number,
    status
  ) values (
    target_page_id,
    current_user_id,
    target_document_id,
    1,
    'pending'
  );

  insert into public.ocr_jobs (
    id,
    user_id,
    page_id,
    provider,
    prompt_version,
    status,
    idempotency_key
  ) values (
    target_job_id,
    current_user_id,
    target_page_id,
    'gemini',
    prompt_version,
    'pending',
    'ocr:' || target_page_id::text || ':v' || prompt_version::text
  );

  return query select target_document_id, target_page_id, target_job_id;
end;
$$;

revoke execute on function public.create_drive_image_import(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz,
  text, text, text, text, timestamptz, integer
) from public, anon;
grant execute on function public.create_drive_image_import(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz,
  text, text, text, text, timestamptz, integer
) to authenticated;

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
