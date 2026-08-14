-- Store one Drive original per image page so a set of photographed sheets can be
-- represented as one logical document without flattening the sources into a PDF.

alter table public.pages
  add column source_drive_file_id text,
  add column prepared_sha256 text,
  add column source_sha256 text;

alter table public.pages
  add constraint pages_source_drive_file_id_format check (
    source_drive_file_id is null
    or (
      char_length(source_drive_file_id) between 10 and 256
      and source_drive_file_id ~ '^[A-Za-z0-9_-]+$'
    )
  ),
  add constraint pages_prepared_sha256_format check (
    prepared_sha256 is null or prepared_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint pages_source_sha256_format check (
    source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'
  );

create index pages_user_prepared_sha256_idx
  on public.pages (user_id, prepared_sha256)
  where prepared_sha256 is not null;

create index pages_user_source_sha256_idx
  on public.pages (user_id, source_sha256)
  where source_sha256 is not null;

-- Existing direct-image documents already keep their first source on documents.
-- Mirror that identity onto page 1 so the viewer can use one page-level contract
-- for both legacy one-page images and new multipage photo documents.
update public.pages as page
set source_drive_file_id = document.drive_file_id,
    prepared_sha256 = document.sha256,
    source_sha256 = document.source_sha256
from public.documents as document
where page.document_id = document.id
  and page.user_id = document.user_id
  and page.page_number = 1
  and document.kind = 'image'
  and document.drive_file_id is not null;

create or replace function public.bind_first_image_page_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_document record;
begin
  if new.page_number <> 1
    or new.source_drive_file_id is not null
    or new.prepared_sha256 is not null
    or new.source_sha256 is not null
  then
    return new;
  end if;

  select kind, drive_file_id, sha256, source_sha256
  into source_document
  from public.documents
  where id = new.document_id
    and user_id = new.user_id;

  if found and source_document.kind = 'image' then
    new.source_drive_file_id := source_document.drive_file_id;
    new.prepared_sha256 := source_document.sha256;
    new.source_sha256 := source_document.source_sha256;
  end if;
  return new;
end;
$$;

create trigger pages_bind_first_image_source
  before insert on public.pages
  for each row execute function public.bind_first_image_page_source();

revoke execute on function public.bind_first_image_page_source() from public, anon, authenticated;

create or replace function public.append_drive_image_page_v1(
  target_document_id uuid,
  target_page_id uuid,
  target_job_id uuid,
  target_page_number integer,
  target_drive_file_id text,
  target_drive_parent_folder_id text,
  target_drive_mime_type text,
  target_drive_modified_time timestamptz,
  target_drive_version text,
  target_drive_md5_checksum text,
  ocr_storage_path text,
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
  target_document record;
begin
  if current_user_id is null or not (select public.is_authorized_user()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if target_page_number not between 2 and 10000
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
    or ocr_storage_path not like current_user_id::text || '/%'
    or ocr_storage_path !~ '^[A-Za-z0-9_./-]+\.(webp|jpg)$'
  then
    raise exception 'invalid multipage image metadata' using errcode = '22023';
  end if;

  select id, kind, page_count, drive_parent_folder_id, physical_state
  into target_document
  from public.documents
  where id = target_document_id
    and user_id = current_user_id
  for update;

  if not found
    or target_document.kind <> 'image'
    or target_document.physical_state <> 'available'
    or target_document.drive_parent_folder_id is distinct from target_drive_parent_folder_id
  then
    raise exception 'invalid image document' using errcode = '42501';
  end if;

  if target_page_number <> target_document.page_count + 1 then
    raise exception 'invalid page order' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.pages as page
    where page.user_id = current_user_id
      and (
        page.prepared_sha256 = append_drive_image_page_v1.prepared_sha256
        or page.source_sha256 = append_drive_image_page_v1.source_sha256
      )
  ) then
    raise exception 'duplicate image page' using errcode = '23505';
  end if;

  insert into public.pages (
    id, user_id, document_id, page_number, temporary_image_path,
    source_drive_file_id, prepared_sha256, source_sha256, status,
    ocr_preprocessing_profile, ocr_preprocessing_version,
    ocr_preprocessing_auto_crop, ocr_preprocessing_retained_permille,
    ocr_preprocessing_deskew_mdeg, ocr_preprocessing_illumination,
    ocr_preprocessing_contrast, ocr_preprocessing_fallback,
    ocr_preprocessing_source_width, ocr_preprocessing_source_height,
    ocr_preprocessing_prepared_width, ocr_preprocessing_prepared_height,
    ocr_preprocessing_original_bytes, ocr_preprocessing_prepared_bytes
  ) values (
    target_page_id, current_user_id, target_document_id, target_page_number,
    ocr_storage_path, target_drive_file_id, prepared_sha256, source_sha256, 'pending',
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

revoke execute on function public.append_drive_image_page_v1(
  uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text,
  text, text, text, text, integer, boolean, integer, integer, boolean,
  boolean, boolean, integer, integer, integer, integer, bigint, bigint, integer
) from public, anon;

grant execute on function public.append_drive_image_page_v1(
  uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text,
  text, text, text, text, integer, boolean, integer, integer, boolean,
  boolean, boolean, integer, integer, integer, integer, bigint, bigint, integer
) to authenticated;
