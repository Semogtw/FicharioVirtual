begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'legacy-migration@example.test');
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
  'google-subject-legacy',
  'legacy-migration@example.test',
  '0ARootFolderId_123456789',
  'start-token'
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

insert into public.documents (
  id,
  user_id,
  notebook_id,
  title,
  kind,
  original_filename,
  storage_path,
  sha256,
  page_count,
  status
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Apostila',
  'pdf',
  'apostila.pdf',
  '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original.pdf',
  repeat('a', 64),
  12,
  'ready'
);

select is(
  public.complete_drive_legacy_migration(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original.pdf',
    '1MigratedDriveFileId_123456789',
    '0ABiologyFolderId_123456789',
    'application/pdf',
    '2026-08-06T12:00:00Z',
    '1',
    'd41d8cd98f00b204e9800998ecf8427e'
  ),
  true,
  'legacy original is linked to its Drive copy'
);

select results_eq(
  $$
    select
      title,
      sha256,
      page_count,
      status::text,
      storage_path,
      drive_file_id,
      drive_parent_folder_id,
      drive_sync_status::text,
      drive_migrated_at is not null
    from public.documents
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$
    values (
      'Apostila'::text,
      repeat('a', 64)::text,
      12,
      'ready'::text,
      '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original.pdf'::text,
      '1MigratedDriveFileId_123456789'::text,
      '0ABiologyFolderId_123456789'::text,
      'synced'::text,
      true
    )
  $$,
  'migration preserves product metadata and the Storage fallback'
);

select is(
  public.complete_drive_legacy_migration(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original.pdf',
    '1MigratedDriveFileId_123456789',
    '0ABiologyFolderId_123456789',
    'application/pdf',
    '2026-08-06T12:00:00Z',
    '1',
    'd41d8cd98f00b204e9800998ecf8427e'
  ),
  true,
  'replaying the same migration is idempotent'
);

select throws_ok(
  $$
    select public.complete_drive_legacy_migration(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/wrong.pdf',
      '2DifferentDriveFileId_123456789',
      '0ABiologyFolderId_123456789',
      'application/pdf',
      '2026-08-06T12:05:00Z',
      '1',
      null
    )
  $$,
  '22023',
  null,
  'legacy migration uses compare-and-swap on the expected Storage path'
);

insert into public.documents (
  id,
  user_id,
  notebook_id,
  title,
  kind,
  original_filename,
  storage_path,
  page_count,
  status
) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Imagem',
  'image',
  'imagem.webp',
  '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc/original.webp',
  1,
  'ready'
);

select throws_ok(
  $$
    select public.complete_drive_legacy_migration(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc/original.webp',
      '3WrongFolderFileId_123456789',
      '0AWrongFolderId_123456789',
      'image/webp',
      '2026-08-06T12:10:00Z',
      '1',
      null
    )
  $$,
  '42501',
  null,
  'migration copy must be inside the document notebook folder'
);

select throws_ok(
  $$
    select public.complete_drive_legacy_migration(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc/original.webp',
      '3WrongMimeFileId_123456789',
      '0ABiologyFolderId_123456789',
      'application/pdf',
      '2026-08-06T12:10:00Z',
      '1',
      null
    )
  $$,
  '22023',
  null,
  'migration MIME type must match the legacy document kind'
);

select throws_ok(
  $$
    select public.complete_drive_legacy_migration(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc/original.webp',
      '1MigratedDriveFileId_123456789',
      '0ABiologyFolderId_123456789',
      'image/webp',
      '2026-08-06T12:10:00Z',
      '1',
      null
    )
  $$,
  '23505',
  null,
  'one Drive identity cannot migrate two documents'
);

select is(
  (select drive_file_id from public.documents where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  null,
  'failed migration attempts leave the legacy document unchanged'
);
select is(
  (select storage_path from public.documents where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc/original.webp',
  'failed migration attempts preserve the Storage original'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  $$
    select public.complete_drive_legacy_migration(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc/original.webp',
      '4AnonymousFileId_123456789',
      '0ABiologyFolderId_123456789',
      'image/webp',
      '2026-08-06T12:15:00Z',
      '1',
      null
    )
  $$,
  '42501',
  null,
  'anonymous users cannot publish Drive migrations'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is(
  (select count(*) from public.documents where drive_migrated_at is not null),
  1::bigint,
  'only the successful migration receives a durable receipt'
);

select * from finish();
rollback;
