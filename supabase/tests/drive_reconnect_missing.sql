begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'drive-reconnect@example.test');
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
  'google-subject-reconnect',
  'drive-reconnect@example.test',
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

select *
from public.create_drive_image_import(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Fotossíntese',
  'fotossintese.webp',
  '1OldDriveFileId_123456789',
  '0ABiologyFolderId_123456789',
  'image/webp',
  '2026-08-06T09:00:00Z',
  '3',
  'd41d8cd98f00b204e9800998ecf8427e',
  '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/thumbnail.jpg',
  repeat('a', 64),
  null,
  1
);

select is(
  public.mark_drive_file_missing('1OldDriveFileId_123456789'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'test document is marked missing first'
);

insert into public.drive_sync_jobs (
  id,
  user_id,
  operation,
  status,
  document_id,
  drive_file_id,
  idempotency_key,
  payload,
  finished_at
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '11111111-1111-4111-8111-111111111111',
  'apply_remote_change',
  'conflict',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '1OldDriveFileId_123456789',
  'reconnect-conflict-event',
  '{"outcome":"conflict"}'::jsonb,
  timezone('utc', now())
);
insert into public.drive_conflicts (
  id,
  user_id,
  job_id,
  document_id,
  kind,
  local_snapshot,
  remote_snapshot
) values (
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  '11111111-1111-4111-8111-111111111111',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'remote_deleted_local_changed',
  '{"title":"Fotossíntese"}'::jsonb,
  '{"removed":true}'::jsonb
);

select is(
  public.reconnect_missing_drive_document(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '2NewDriveFileId_123456789',
    '0ABiologyFolderId_123456789',
    'image/webp',
    '2026-08-06T11:00:00Z',
    '1',
    'e41d8cd98f00b204e9800998ecf8427e'
  ),
  true,
  'missing document accepts an explicit replacement original'
);

select results_eq(
  $$
    select
      title,
      sha256,
      drive_file_id,
      drive_parent_folder_id,
      drive_version,
      physical_state::text,
      drive_sync_status::text
    from public.documents
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$
    values (
      'Fotossíntese'::text,
      repeat('a', 64)::text,
      '2NewDriveFileId_123456789'::text,
      '0ABiologyFolderId_123456789'::text,
      '1'::text,
      'available'::text,
      'synced'::text
    )
  $$,
  'reconnection changes only the physical identity and preserves searchable metadata'
);

select is(
  (select count(*) from public.pages where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1::bigint,
  'existing pages survive reconnection'
);
select results_eq(
  $$
    select resolution, resolved_at is not null
    from public.drive_conflicts
    where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  $$,
  $$ values ('reconnected_original'::text, true) $$,
  'open conflicts for the document close explicitly after reconnection'
);

select throws_ok(
  $$
    select public.reconnect_missing_drive_document(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '3AnotherDriveFileId_123456789',
      '0ABiologyFolderId_123456789',
      'image/webp',
      '2026-08-06T11:05:00Z',
      '1',
      null
    )
  $$,
  '22023',
  null,
  'available documents cannot be replaced silently'
);

select is(
  public.mark_drive_file_missing('2NewDriveFileId_123456789'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'replacement can later become missing again'
);

select throws_ok(
  $$
    select public.reconnect_missing_drive_document(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '3WrongFolderFileId_123456789',
      '0AWrongFolderId_123456789',
      'image/webp',
      '2026-08-06T11:10:00Z',
      '1',
      null
    )
  $$,
  '42501',
  null,
  'replacement must belong to the selected notebook folder'
);

select throws_ok(
  $$
    select public.reconnect_missing_drive_document(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '3WrongMimeFileId_123456789',
      '0ABiologyFolderId_123456789',
      'application/pdf',
      '2026-08-06T11:10:00Z',
      '1',
      null
    )
  $$,
  '22023',
  null,
  'replacement MIME type must match the document kind'
);

insert into public.documents (
  id,
  user_id,
  title,
  kind,
  original_filename,
  storage_path,
  drive_file_id,
  drive_parent_folder_id,
  drive_mime_type,
  drive_modified_time,
  drive_version,
  physical_state,
  drive_sync_status
) values (
  '99999999-9999-4999-8999-999999999999',
  '11111111-1111-4111-8111-111111111111',
  'Outro',
  'image',
  'outro.webp',
  null,
  '4ExistingDriveFileId_123456789',
  '0ARootFolderId_123456789',
  'image/webp',
  '2026-08-06T11:00:00Z',
  '1',
  'available',
  'synced'
);

select throws_ok(
  $$
    select public.reconnect_missing_drive_document(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '4ExistingDriveFileId_123456789',
      '0ABiologyFolderId_123456789',
      'image/webp',
      '2026-08-06T11:15:00Z',
      '1',
      null
    )
  $$,
  '23505',
  null,
  'one Drive identity cannot reconnect two records'
);

select is(
  (select title from public.documents where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'Fotossíntese',
  'failed reconnect attempts never erase metadata'
);

select * from finish();
rollback;
