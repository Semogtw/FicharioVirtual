-- Preserve the user-provided image separately from the OCR derivative and keep
-- preprocessing provenance numeric/allowlisted. No OCR text or image bytes are
-- stored in these metadata columns.

alter table public.documents
  add column if not exists source_storage_path text,
  add column if not exists source_sha256 text;

alter table public.documents
  drop constraint if exists documents_source_sha256_check;
alter table public.documents
  add constraint documents_source_sha256_check check (
    source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'
  );

alter table public.pages
  add column if not exists ocr_preprocessing_profile text,
  add column if not exists ocr_preprocessing_version integer,
  add column if not exists ocr_preprocessing_auto_crop boolean not null default false,
  add column if not exists ocr_preprocessing_retained_permille integer not null default 1000,
  add column if not exists ocr_preprocessing_deskew_mdeg integer not null default 0,
  add column if not exists ocr_preprocessing_illumination boolean not null default false,
  add column if not exists ocr_preprocessing_contrast boolean not null default false,
  add column if not exists ocr_preprocessing_fallback boolean not null default false,
  add column if not exists ocr_preprocessing_source_width integer,
  add column if not exists ocr_preprocessing_source_height integer,
  add column if not exists ocr_preprocessing_prepared_width integer,
  add column if not exists ocr_preprocessing_prepared_height integer,
  add column if not exists ocr_preprocessing_original_bytes bigint,
  add column if not exists ocr_preprocessing_prepared_bytes bigint;

alter table public.pages
  drop constraint if exists pages_ocr_preprocessing_profile_check,
  drop constraint if exists pages_ocr_preprocessing_version_check,
  drop constraint if exists pages_ocr_preprocessing_retained_check,
  drop constraint if exists pages_ocr_preprocessing_deskew_check,
  drop constraint if exists pages_ocr_preprocessing_dimensions_check,
  drop constraint if exists pages_ocr_preprocessing_bytes_check;

alter table public.pages
  add constraint pages_ocr_preprocessing_profile_check check (
    ocr_preprocessing_profile is null
    or ocr_preprocessing_profile in ('ocr_clean_v1')
  ),
  add constraint pages_ocr_preprocessing_version_check check (
    ocr_preprocessing_version is null or ocr_preprocessing_version between 1 and 10000
  ),
  add constraint pages_ocr_preprocessing_retained_check check (
    ocr_preprocessing_retained_permille between 1 and 1000
  ),
  add constraint pages_ocr_preprocessing_deskew_check check (
    ocr_preprocessing_deskew_mdeg between -4000 and 4000
  ),
  add constraint pages_ocr_preprocessing_dimensions_check check (
    (ocr_preprocessing_source_width is null or ocr_preprocessing_source_width between 1 and 100000)
    and (ocr_preprocessing_source_height is null or ocr_preprocessing_source_height between 1 and 100000)
    and (ocr_preprocessing_prepared_width is null or ocr_preprocessing_prepared_width between 1 and 100000)
    and (ocr_preprocessing_prepared_height is null or ocr_preprocessing_prepared_height between 1 and 100000)
  ),
  add constraint pages_ocr_preprocessing_bytes_check check (
    (ocr_preprocessing_original_bytes is null or ocr_preprocessing_original_bytes between 1 and 67108864)
    and (ocr_preprocessing_prepared_bytes is null or ocr_preprocessing_prepared_bytes between 1 and 67108864)
  );

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
    'image', original_filename, prepared_storage_path, source_storage_path,
    thumbnail_storage_path, 1, 'pending', prepared_sha256, source_sha256,
    source_created_at
  );

  insert into public.pages (
    id, user_id, document_id, page_number, status,
    ocr_preprocessing_profile, ocr_preprocessing_version,
    ocr_preprocessing_auto_crop, ocr_preprocessing_retained_permille,
    ocr_preprocessing_deskew_mdeg, ocr_preprocessing_illumination,
    ocr_preprocessing_contrast, ocr_preprocessing_fallback,
    ocr_preprocessing_source_width, ocr_preprocessing_source_height,
    ocr_preprocessing_prepared_width, ocr_preprocessing_prepared_height,
    ocr_preprocessing_original_bytes, ocr_preprocessing_prepared_bytes
  ) values (
    target_page_id, current_user_id, target_document_id, 1, 'pending',
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

revoke execute on function public.create_image_import_v2(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  integer, boolean, integer, integer, boolean, boolean, boolean, integer,
  integer, integer, integer, bigint, bigint, timestamptz, integer
) from public, anon;
grant execute on function public.create_image_import_v2(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text,
  integer, boolean, integer, integer, boolean, boolean, boolean, integer,
  integer, integer, integer, bigint, bigint, timestamptz, integer
) to authenticated;

create or replace function public.create_drive_image_import_v2(
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
  ocr_storage_path text,
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
  expected_parent_folder_id text;
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
    or char_length(target_drive_file_id) not between 10 and 256
    or target_drive_file_id !~ '^[A-Za-z0-9_-]+$'
    or char_length(target_drive_parent_folder_id) not between 10 and 256
    or target_drive_parent_folder_id !~ '^[A-Za-z0-9_-]+$'
    or char_length(target_drive_mime_type) not between 1 and 256
    or target_drive_mime_type not like 'image/%'
    or target_drive_modified_time is null
    or target_drive_version !~ '^\d{1,32}$'
    or (target_drive_md5_checksum is not null and target_drive_md5_checksum !~ '^[0-9a-fA-F]{32}$')
  then
    raise exception 'invalid Drive image preprocessing metadata' using errcode = '22023';
  end if;
  if ocr_storage_path not like current_user_id::text || '/%'
    or thumbnail_storage_path not like current_user_id::text || '/%'
    or ocr_storage_path !~ '^[A-Za-z0-9_./-]+\.(webp|jpg)$'
    or thumbnail_storage_path !~ '^[A-Za-z0-9_./-]+\.(webp|jpg)$'
    or ocr_storage_path = thumbnail_storage_path
  then
    raise exception 'invalid temporary image ownership' using errcode = '42501';
  end if;

  if target_notebook_id is null then
    select connection.root_folder_id into expected_parent_folder_id
    from public.drive_connections as connection
    where connection.user_id = current_user_id
      and connection.status in ('connected', 'syncing');
  else
    select notebook.drive_folder_id into expected_parent_folder_id
    from public.notebooks as notebook
    where notebook.id = target_notebook_id
      and notebook.user_id = current_user_id
      and not notebook.drive_missing;
  end if;
  if expected_parent_folder_id is null or expected_parent_folder_id <> target_drive_parent_folder_id then
    raise exception 'invalid Drive parent folder' using errcode = '42501';
  end if;

  insert into public.documents (
    id, user_id, notebook_id, title, kind, original_filename, storage_path,
    source_storage_path, thumbnail_path, page_count, status, sha256, source_sha256,
    source_created_at, drive_file_id, drive_parent_folder_id, drive_mime_type,
    drive_modified_time, drive_version, drive_md5_checksum, physical_state, drive_sync_status
  ) values (
    target_document_id, current_user_id, target_notebook_id, trim(document_title),
    'image', original_filename, null, null, thumbnail_storage_path, 1, 'pending',
    prepared_sha256, source_sha256, source_created_at, target_drive_file_id,
    target_drive_parent_folder_id, target_drive_mime_type, target_drive_modified_time,
    target_drive_version, lower(target_drive_md5_checksum), 'available', 'synced'
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
    target_page_id, current_user_id, target_document_id, 1, ocr_storage_path, 'pending',
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

revoke execute on function public.create_drive_image_import_v2(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz, text,
  text, text, text, text, text, text, integer, boolean, integer, integer,
  boolean, boolean, boolean, integer, integer, integer, integer, bigint,
  bigint, timestamptz, integer
) from public, anon;
grant execute on function public.create_drive_image_import_v2(
  uuid, uuid, uuid, uuid, text, text, text, text, text, timestamptz, text,
  text, text, text, text, text, text, integer, boolean, integer, integer,
  boolean, boolean, boolean, integer, integer, integer, integer, bigint,
  bigint, timestamptz, integer
) to authenticated;
