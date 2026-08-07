begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'drive-sync@example.test');
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
  'google-subject-drive-sync',
  'drive-sync@example.test',
  '0ARootFolderId_123456789',
  'start-change-token'
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
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
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

reset role;
set local role service_role;

select is(
  public.begin_drive_remote_sync('11111111-1111-4111-8111-111111111111'),
  'start-change-token',
  'remote sync begins from the durable start token'
);
reset role;
select is(
  (select status::text from public.drive_connections where user_id = '11111111-1111-4111-8111-111111111111'),
  'syncing',
  'beginning sync marks the connection syncing'
);

set local role service_role;
select is(
  public.apply_drive_remote_change(
    '11111111-1111-4111-8111-111111111111',
    'remote:start-change-token:1AbCdEfGhIjKlMnOpQrStUvWxYz_123456:4',
    '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
    false,
    'fotossintese-renomeada.webp',
    'image/webp',
    '0ABiologyFolderId_123456789',
    '2026-08-06T10:00:00Z',
    '4',
    'e41d8cd98f00b204e9800998ecf8427e',
    false
  ),
  'applied',
  'known file metadata is updated by Drive identity'
);
reset role;
select results_eq(
  $$
    select drive_version, drive_md5_checksum, physical_state::text, drive_sync_status::text
    from public.documents
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$
    values (
      '4'::text,
      'e41d8cd98f00b204e9800998ecf8427e'::text,
      'available'::text,
      'synced'::text
    )
  $$,
  'known file remains available with fresh Drive metadata'
);

set local role service_role;
select is(
  public.apply_drive_remote_change(
    '11111111-1111-4111-8111-111111111111',
    'remote:start-change-token:1AbCdEfGhIjKlMnOpQrStUvWxYz_123456:removed',
    '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
    true,
    null,
    null,
    null,
    null,
    null,
    null,
    false
  ),
  'applied',
  'removed Drive file is applied without deleting its record'
);
reset role;
select results_eq(
  $$
    select title, sha256, physical_state::text
    from public.documents
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$
    values ('Fotossíntese'::text, repeat('a', 64)::text, 'missing'::text)
  $$,
  'removed file preserves searchable metadata and text identity'
);

set local role service_role;
select is(
  public.apply_drive_remote_change(
    '11111111-1111-4111-8111-111111111111',
    'remote:start-change-token:9UnknownDriveFileId_123456:removed',
    '9UnknownDriveFileId_123456',
    true,
    null,
    null,
    null,
    null,
    null,
    null,
    false
  ),
  'ignored',
  'unknown Drive changes are ignored instead of imported implicitly'
);
reset role;

set local role service_role;
select is(
  public.apply_drive_remote_change(
    '11111111-1111-4111-8111-111111111111',
    'remote:start-change-token:0ABiologyFolderId_123456789:5',
    '0ABiologyFolderId_123456789',
    false,
    'Ciências Biológicas',
    'application/vnd.google-apps.folder',
    '0ARootFolderId_123456789',
    '2026-08-06T10:05:00Z',
    '5',
    null,
    false
  ),
  'applied',
  'known Drive folder updates its notebook'
);
reset role;
select results_eq(
  $$
    select name, parent_notebook_id, drive_version, drive_missing
    from public.notebooks
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  $$,
  $$
    values ('Ciências Biológicas'::text, null::uuid, '5'::text, false)
  $$,
  'notebook reflects its remote folder metadata'
);

set local role service_role;
select is(
  public.apply_drive_remote_change(
    '11111111-1111-4111-8111-111111111111',
    'remote:start-change-token:1AbCdEfGhIjKlMnOpQrStUvWxYz_123456:6',
    '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
    false,
    'fora-da-hierarquia.webp',
    'image/webp',
    '0AUnknownParentFolder_123456789',
    '2026-08-06T10:10:00Z',
    '6',
    null,
    false
  ),
  'conflict',
  'unknown parent folder isolates one conflict'
);
reset role;
select is(
  (select count(*) from public.drive_conflicts where resolved_at is null),
  1::bigint,
  'one open conflict is recorded'
);
select is(
  (select count(*) from public.drive_sync_jobs where status = 'conflict'),
  1::bigint,
  'conflict has an idempotent sync job receipt'
);
set local role service_role;
select is(
  public.apply_drive_remote_change(
    '11111111-1111-4111-8111-111111111111',
    'remote:start-change-token:1AbCdEfGhIjKlMnOpQrStUvWxYz_123456:6',
    '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
    false,
    'fora-da-hierarquia.webp',
    'image/webp',
    '0AUnknownParentFolder_123456789',
    '2026-08-06T10:10:00Z',
    '6',
    null,
    false
  ),
  'conflict',
  'replaying the same remote event is idempotent'
);
reset role;
select is(
  (select count(*) from public.drive_conflicts where resolved_at is null),
  1::bigint,
  'replay does not duplicate the conflict'
);

set local role service_role;
select is(
  public.persist_drive_change_checkpoint(
    '11111111-1111-4111-8111-111111111111',
    'start-change-token',
    'next-change-token',
    false
  ),
  true,
  'intermediate page token advances by compare-and-swap'
);
select is(
  public.persist_drive_change_checkpoint(
    '11111111-1111-4111-8111-111111111111',
    'start-change-token',
    'stale-write-token',
    false
  ),
  false,
  'stale checkpoint cannot overwrite a newer token'
);
select is(
  public.persist_drive_change_checkpoint(
    '11111111-1111-4111-8111-111111111111',
    'next-change-token',
    'fresh-start-token',
    true
  ),
  true,
  'final page promotes the new durable start token'
);
reset role;
select results_eq(
  $$
    select status::text, start_page_token, next_page_token, last_error_code
    from public.drive_connections
    where user_id = '11111111-1111-4111-8111-111111111111'
  $$,
  $$
    values ('connected'::text, 'fresh-start-token'::text, null::text, null::text)
  $$,
  'successful sync closes cleanly on the final token'
);

set local role service_role;
select is(
  public.fail_drive_remote_sync(
    '11111111-1111-4111-8111-111111111111',
    'drive_rate_limited',
    'Google Drive temporariamente indisponível.'
  ),
  true,
  'sync failure is persisted without discarding checkpoints'
);
reset role;
select results_eq(
  $$
    select status::text, start_page_token, last_error_code, last_error_message
    from public.drive_connections
    where user_id = '11111111-1111-4111-8111-111111111111'
  $$,
  $$
    values (
      'error'::text,
      'fresh-start-token'::text,
      'drive_rate_limited'::text,
      'Google Drive temporariamente indisponível.'::text
    )
  $$,
  'failure state remains resumable and sanitized'
);

select * from finish();
rollback;
