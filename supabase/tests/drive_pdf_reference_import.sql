begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'drive-reference@example.test');
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
  'google-subject-reference-user',
  'drive-reference@example.test',
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
  'Arquivos grandes',
  '0ALargePdfFolderId_123456789',
  'synced'
);

select lives_ok(
  $$
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
    )
  $$,
  'oversized Drive PDF can be staged without downloading the full original'
);

select results_eq(
  $$
    select
      storage_path,
      page_count,
      status::text,
      drive_file_id,
      drive_parent_folder_id,
      drive_mime_type,
      physical_state::text,
      drive_sync_status::text
    from public.documents
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$
    values (
      null::text,
      0::integer,
      'uploading'::text,
      '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456'::text,
      '0ALargePdfFolderId_123456789'::text,
      'application/pdf'::text,
      'available'::text,
      'synced'::text
    )
  $$,
  'staged document owns the copied Drive identity before inspection'
);

select results_eq(
  $$
    select source_size_bytes, source_modified_at, status, last_error_code
    from public.drive_pdf_reference_imports
    where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$
    values (
      125829120::bigint,
      '2026-08-05T12:00:00Z'::timestamptz,
      'pending_inspection'::text,
      null::text
    )
  $$,
  'reference staging persists only resumable metadata and progress state'
);

select throws_ok(
  $$
    select public.stage_drive_pdf_reference(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Pasta errada',
      'pasta-errada.pdf',
      '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
      '0AWrongFolderId_123456789',
      '2026-08-07T10:00:00Z',
      '1',
      null,
      62914560,
      '2026-08-05T12:00:00Z'
    )
  $$,
  '42501',
  null,
  'reference staging rejects a Drive parent outside the selected notebook'
);

delete from public.documents where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is(
  (select count(*) from public.drive_pdf_reference_imports),
  0::bigint,
  'reference metadata is deleted with its logical document'
);

select * from finish();
rollback;
