begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'drive-import@example.test');
insert into public.app_users (user_id, is_active)
values ('11111111-1111-4111-8111-111111111111', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

insert into public.drive_connections (
  user_id,
  status,
  google_subject,
  google_email,
  root_folder_id,
  start_page_token
) values (
  '11111111-1111-4111-8111-111111111111',
  'connected',
  'google-subject-import-user',
  'drive-import@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

insert into public.notebooks (
  id,
  user_id,
  name,
  drive_folder_id,
  drive_sync_status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Biologia',
  '0ABiologyFolderId_123456789',
  'synced'
);

select lives_ok(
  $$
    select *
    from public.create_drive_image_import(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Fotossíntese',
      'fotossintese.webp',
      '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
      '0ABiologyFolderId_123456789',
      'image/webp',
      '2026-08-06T07:00:00Z',
      '3',
      'd41d8cd98f00b204e9800998ecf8427e',
      '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/thumbnail.jpg',
      repeat('a', 64),
      '2026-08-05T10:00:00Z',
      1
    )
  $$,
  'Drive image metadata is published without a permanent Supabase original'
);

select results_eq(
  $$
    select
      storage_path,
      drive_file_id,
      drive_parent_folder_id,
      drive_mime_type,
      drive_version,
      drive_md5_checksum,
      physical_state::text,
      drive_sync_status::text
    from public.documents
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$
    values (
      null::text,
      '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456'::text,
      '0ABiologyFolderId_123456789'::text,
      'image/webp'::text,
      '3'::text,
      'd41d8cd98f00b204e9800998ecf8427e'::text,
      'available'::text,
      'synced'::text
    )
  $$,
  'Drive image document stores the physical Drive identity'
);

select is(
  (select thumbnail_path from public.documents where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/thumbnail.jpg',
  'image thumbnail remains a private processing artifact'
);

select is(
  (select status::text from public.pages where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'pending',
  'Drive image creates the OCR page'
);

select is(
  (select status::text from public.ocr_jobs where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  'pending',
  'Drive image creates the OCR job'
);

select throws_ok(
  $$
    select *
    from public.create_drive_image_import(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      '99999999-9999-4999-8999-999999999999',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Pasta errada',
      'errada.webp',
      '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
      '0AWrongFolderId_123456789',
      'image/webp',
      '2026-08-06T07:00:00Z',
      '1',
      null,
      '11111111-1111-4111-8111-111111111111/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/thumbnail.jpg',
      repeat('b', 64),
      null,
      1
    )
  $$,
  '42501',
  null,
  'Drive import cannot publish into a folder different from the selected notebook'
);

select lives_ok(
  $$
    select public.create_drive_pdf_import(
      '12121212-1212-4121-8121-121212121212',
      null,
      'Apostila',
      'apostila.pdf',
      '3AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
      '0ARootFolderId_123456789',
      'application/pdf',
      '2026-08-06T07:30:00Z',
      '8',
      'e41d8cd98f00b204e9800998ecf8427e',
      repeat('c', 64),
      '2026-08-04T12:00:00Z',
      jsonb_build_array(
        jsonb_build_object(
          'id', '13131313-1313-4131-8131-131313131313',
          'pageNumber', 1,
          'nativeText', 'Texto nativo',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', null
        ),
        jsonb_build_object(
          'id', '14141414-1414-4141-8141-141414141414',
          'pageNumber', 2,
          'nativeText', null,
          'needsOcr', true,
          'temporaryImagePath', '11111111-1111-4111-8111-111111111111/12121212-1212-4121-8121-121212121212/pages/2.webp',
          'jobId', '15151515-1515-4151-8151-151515151515'
        )
      ),
      1
    )
  $$,
  'Drive PDF metadata is published with temporary OCR pages only'
);

select results_eq(
  $$
    select storage_path, drive_file_id, drive_parent_folder_id, page_count, status::text
    from public.documents
    where id = '12121212-1212-4121-8121-121212121212'
  $$,
  $$
    values (
      null::text,
      '3AbCdEfGhIjKlMnOpQrStUvWxYz_123456'::text,
      '0ARootFolderId_123456789'::text,
      2::integer,
      'partially_ready'::text
    )
  $$,
  'Drive PDF document is linked to the root and remains searchable during OCR'
);

select is(
  (select extraction_source::text from public.pages where id = '13131313-1313-4131-8131-131313131313'),
  'native_pdf',
  'native PDF page is preserved without OCR'
);

select is(
  (select temporary_image_path from public.pages where id = '14141414-1414-4141-8141-141414141414'),
  '11111111-1111-4111-8111-111111111111/12121212-1212-4121-8121-121212121212/pages/2.webp',
  'OCR PDF page keeps only its temporary processing image'
);

select is(
  (select status::text from public.ocr_jobs where id = '15151515-1515-4151-8151-151515151515'),
  'pending',
  'Drive PDF creates OCR jobs only for pages that need them'
);

select is(
  (select count(*) from public.pages where document_id = '12121212-1212-4121-8121-121212121212'),
  2::bigint,
  'Drive PDF publishes all page descriptors atomically'
);

select * from finish();
rollback;
