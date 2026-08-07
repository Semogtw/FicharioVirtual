begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'drive-finalize@example.test');
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
  'google-subject-finalize-user',
  'drive-finalize@example.test',
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
  'PDF remoto',
  '0ALargePdfFolderId_123456789',
  'synced'
);

select public.stage_drive_pdf_reference(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Apostila grande',
  'apostila-grande.pdf',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  '0ALargePdfFolderId_123456789',
  '2026-08-07T10:00:00Z',
  '2',
  'd41d8cd98f00b204e9800998ecf8427e',
  125829120,
  '2026-08-05T12:00:00Z'
);

select lives_ok(
  $$
    select public.finalize_drive_pdf_reference_import(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'pageNumber', 1,
          'nativeText', 'Texto nativo da primeira página',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', null
        ),
        jsonb_build_object(
          'id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'pageNumber', 2,
          'nativeText', null,
          'needsOcr', true,
          'temporaryImagePath', '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/pages/2.webp',
          'jobId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
        )
      ),
      1
    )
  $$,
  'staged Drive PDF can be finalized atomically from range-inspection descriptors'
);

select results_eq(
  $$
    select page_count, status::text, sha256, drive_file_id, storage_path
    from public.documents
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$
    values (
      2::integer,
      'partially_ready'::text,
      null::text,
      '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456'::text,
      null::text
    )
  $$,
  'finalization preserves Drive identity and does not require a whole-file hash'
);

select results_eq(
  $$
    select page_number, native_text, extraction_source::text, temporary_image_path, status::text
    from public.pages
    where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    order by page_number
  $$,
  $$
    values
      (1, 'Texto nativo da primeira página'::text, 'native_pdf'::text, null::text, 'ready'::text),
      (2, null::text, null::text, '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/pages/2.webp'::text, 'pending'::text)
  $$,
  'native and OCR pages reuse the normal PDF page contract'
);

select results_eq(
  $$
    select provider, prompt_version, status::text, idempotency_key
    from public.ocr_jobs
    where page_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  $$,
  $$
    values (
      'gemini'::text,
      1::integer,
      'pending'::text,
      'ocr:dddddddd-dddd-4ddd-8ddd-dddddddddddd:v1'::text
    )
  $$,
  'OCR page receives the standard provider job contract'
);

select is(
  (select count(*) from public.drive_pdf_reference_imports where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0::bigint,
  'staging metadata is removed only after publication succeeds'
);

select throws_ok(
  $$
    select public.finalize_drive_pdf_reference_import(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          'pageNumber', 1,
          'nativeText', 'Duplicado',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', null
        )
      ),
      1
    )
  $$,
  '55000',
  null,
  'a finalized reference cannot publish pages twice'
);

select * from finish();
rollback;
