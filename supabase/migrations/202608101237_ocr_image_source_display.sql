-- Finalize the direct-image v2 boundary: documents keep/display the raw source,
-- while OCR consumes the prepared derivative through pages.temporary_image_path.
-- Older image imports remain compatible because process-ocr falls back to
-- documents.storage_path when no temporary derivative is present.

create or replace function public.create_image_import_v2(
  target_document_id uuid,
  target_page_id uuid,
  target_job_id uuid,
  target_notebook_id uuid,
  document_title text,
  original_filename text,
  prepared_storage_path text,
  source_storage_path text,
  thumbnail_storage_path text,
  prepared_sha256 text,
  source_sha256 text,
  preprocessing_profile text,
  preprocessing_version integer,
  preprocessing_auto_crop boolean,
  preprocessing_retained_permille integer,
  preprocessing_deskew_mdeg integer,
  preprocessing_illumination boolean,
  preprocessing_contrast boolean,
  preprocessing_fallback boolean,
  preprocessing_source_width integer,
  preprocessing_source_height integer,
  preprocessing_prepared_width integer,
  preprocessing_prepared_height integer,
  preprocessing_original_bytes bigint,
  preprocessing_prepared_bytes bigint,
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
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(trim(document_title)) not between 1 and 240
    or char_length(original_filename) not between 1 and 512
    or prepared_sha256 !~ '^[0-9a-f]{64}$'
    or source_sha256 !~ '^[0-9a-f]{64}$'
    or prompt_version not between 1 and 10000
    or preprocessing_profile <> 'ocr_clean_v1'
    or preprocessing_version <> 1
    or preprocessing_auto_crop is null
    or preprocessing_retained_permille not between 1 and 1000
    or preprocessing_deskew_mdeg not between -4000 and 4000
    or preprocessing_illumination is null
    or preprocessing_contrast is null
    or preprocessing_fallback is null
    or preprocessing_source_width not between 1 and 100000
    or preprocessing_source_height not between 1 and 100000
    or preprocessing_prepared_width not between 1 and 100000
    or preprocessing_prepared_height not between 1 and 100000
    or preprocessing_original_bytes not between 1 and 67108864
    or preprocessing_prepared_bytes not between 1 and 67108864
  then
    raise exception 'invalid image preprocessing metadata' using errcode = '22023';
  end if;
  if prepared_storage_path not like current_user_id::text || '/%'
    or source_storage_path not like current_user_id::text || '/%'
    or thumbnail_storage_path not like current_user_id::text || '/%'
    or prepared_storage_path !~ '^[A-Za-z0-9_./-]+\.(webp|jpg)$'
    or source_storage_path !~ '^[A-Za-z0-9_./-]+\.(webp|jpg|jpeg|png)$'
    or thumbnail_storage_path !~ '^[A-Za-z0-9_./-]+\.(webp|jpg)$'
    or prepared_storage_path = source_storage_path
    or prepared_storage_path = thumbnail_storage_path
    or source_storage_path = thumbnail_storage_path
  then
    raise exception 'invalid image storage ownership' using errcode = '42501';
  end if;
  if target_notebook_id is not null and not exists (
    select 1 from public.notebooks
    where id = target_notebook_id and user_id = current_user_id
  ) then
    raise exception 'invalid notebook' using errcode = '23503';
  end if;

  insert into public.documents (
    id, user_id, notebook_id, title, kind, original_filename,
    storage_path, source_storage_path, thumbnail_path, page_count,
    status, sha256, source_sha256, source_created_at
  ) values (
    target_document_id, current_user_id, target_notebook_id, trim(document_title),
    'image', original_filename, source_storage_path, source_storage_path,
    thumbnail_storage_path, 1, 'pending', prepared_sha256, source_sha256,
    source_created_at
  );

  insert into public.pages (
    id, user_id, document_id, page_number, temporary_image_path, status,
    ocr_preprocessing_profile, ocr_preprocessing_version,
    ocr_preprocessing_auto_crop, ocr_preprocessing_retained_permille,
    ocr_preprocessing_deskew_mdeg, ocr_preprocessing_illumination,
    ocr_preprocessing_contrast, ocr_preprocessing_fallback,
    ocr_preprocessing_source_width, ocr_preprocessing_source_height,
    ocr_preprocessing_prepared_width, ocr_preprocessing_prepared_height,
    ocr_preprocessing_original_bytes, ocr_preprocessing_prepared_bytes
  ) values (
    target_page_id, current_user_id, target_document_id, 1, prepared_storage_path, 'pending',
    preprocessing_profile, preprocessing_version, preprocessing_auto_crop,
    preprocessing_retained_permille, preprocessing_deskew_mdeg,
    preprocessing_illumination, preprocessing_contrast, preprocessing_fallback,
    preprocessing_source_width, preprocessing_source_height,
    preprocessing_prepared_width, preprocessing_prepared_height,
    preprocessing_original_bytes, preprocessing_prepared_bytes
  );

  insert into public.ocr_jobs (
    id, user_id, page_id, provider, prompt_version, status, idempotency_key
  ) values (
    target_job_id, current_user_id, target_page_id, 'gemini', prompt_version,
    'pending', 'ocr:' || target_page_id::text || ':v' || prompt_version::text
  );

  return query select target_document_id, target_page_id, target_job_id;
end;
$$;
