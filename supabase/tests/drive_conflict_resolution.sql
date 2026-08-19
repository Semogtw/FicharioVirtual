begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'conflict-owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'conflict-other@example.test');
insert into public.app_users (user_id, is_active)
values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

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
  'google-subject-conflict',
  'conflict-owner@example.test',
  '0ARootFolderId_123456789',
  'start-token'
);

insert into public.notebooks (
  id,
  user_id,
  name,
  drive_folder_id,
  drive_modified_time,
  drive_version,
  drive_sync_status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Biologia',
  '0ABiologyFolderId_123456789',
  '2026-08-06T15:00:00Z',
  '1',
  'conflict'
);

select *
from public.create_drive_image_import_v2(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Fotossíntese',
      'fotossintese.webp',
      '1ConflictDriveFileId_123456789',
      '0ABiologyFolderId_123456789',
      'image/webp',
      '2026-08-06T15:00:00Z',
      '1',
      'd41d8cd98f00b204e9800998ecf8427e',
      auth.uid()::text || '/' || 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' || '/ocr.webp',
      '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/thumbnail.jpg',
      repeat('a', 64),
      repeat('a', 64),
      'ocr_clean_v1',
      1,
      false,
      1000,
      0,
      true,
      true,
      false,
      1600,
      1200,
      1600,
      1200,
      500000,
      250000,
      null,
      1
    );
update public.documents
set drive_sync_status = 'conflict'
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.pages
set
  ocr_raw_text = 'Texto preservado',
  corrected_text = 'Texto corrigido preservado'
where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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
  'update_file',
  'conflict',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '1ConflictDriveFileId_123456789',
  'conflict-document-retry-job',
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
  'ambiguous_order',
  '{"notebookId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}'::jsonb,
  '{"parents":["0AOne","0ATwo"]}'::jsonb
);

select is(
  public.resolve_drive_conflict(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'retry_local'
  ),
  true,
  'document conflict can retry from current local state'
);
select results_eq(
  $$
    select resolution, resolved_at is not null
    from public.drive_conflicts
    where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  $$,
  $$ values ('retry_local'::text, true) $$,
  'conflict receives a durable resolution receipt'
);
select is(
  (select status::text from public.drive_sync_jobs where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  'cancelled',
  'superseded conflicted job is cancelled'
);
select is(
  (select count(*) from public.drive_sync_jobs where idempotency_key = 'resolution:ffffffff-ffff-4fff-8fff-ffffffffffff:update_file'),
  1::bigint,
  'one fresh file move job is enqueued'
);
select is(
  (select drive_sync_status::text from public.documents where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'pending',
  'document returns to pending state'
);
select is(
  public.resolve_drive_conflict(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'retry_local'
  ),
  true,
  'replaying the same resolution is idempotent'
);
select is(
  (select count(*) from public.drive_sync_jobs where idempotency_key = 'resolution:ffffffff-ffff-4fff-8fff-ffffffffffff:update_file'),
  1::bigint,
  'resolution replay does not duplicate the job'
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
  '12345678-1234-4234-8234-123456789012',
  '11111111-1111-4111-8111-111111111111',
  'update_file',
  'conflict',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '1ConflictDriveFileId_123456789',
  'conflict-document-missing-job',
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
  '23456789-2345-4345-8345-234567890123',
  '11111111-1111-4111-8111-111111111111',
  '12345678-1234-4234-8234-123456789012',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'remote_deleted_local_changed',
  '{"title":"Fotossíntese"}'::jsonb,
  '{"removed":true}'::jsonb
);

select is(
  public.resolve_drive_conflict(
    '23456789-2345-4345-8345-234567890123',
    'mark_missing'
  ),
  true,
  'remote deletion can be accepted as a missing physical original'
);
select results_eq(
  $$
    select
      document.physical_state::text,
      document.drive_sync_status::text,
      document.title,
      page.ocr_raw_text,
      page.corrected_text
    from public.documents as document
    join public.pages as page on page.document_id = document.id
    where document.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and page.page_number = 1
  $$,
  $$ values (
    'missing'::text,
    'synced'::text,
    'Fotossíntese'::text,
    'Texto preservado'::text,
    'Texto corrigido preservado'::text
  ) $$,
  'accepting absence preserves searchable metadata and corrections'
);
select is(
  (select resolution from public.drive_conflicts where id = '23456789-2345-4345-8345-234567890123'),
  'mark_missing',
  'missing resolution is recorded'
);
select is(
  (select status::text from public.drive_sync_jobs where id = '12345678-1234-4234-8234-123456789012'),
  'synced',
  'accepted remote deletion closes the conflicted job'
);

insert into public.drive_sync_jobs (
  id,
  user_id,
  operation,
  status,
  notebook_id,
  drive_file_id,
  idempotency_key,
  payload,
  finished_at
) values (
  '34567890-3456-4456-8456-345678901234',
  '11111111-1111-4111-8111-111111111111',
  'move_folder',
  'conflict',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '0ABiologyFolderId_123456789',
  'conflict-notebook-job',
  '{"outcome":"conflict"}'::jsonb,
  timezone('utc', now())
);
insert into public.drive_conflicts (
  id,
  user_id,
  job_id,
  notebook_id,
  kind,
  local_snapshot,
  remote_snapshot
) values (
  '45678901-4567-4567-8567-456789012345',
  '11111111-1111-4111-8111-111111111111',
  '34567890-3456-4456-8456-345678901234',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'identity_mismatch',
  '{"name":"Biologia"}'::jsonb,
  '{"mimeType":"application/pdf"}'::jsonb
);

select is(
  public.resolve_drive_conflict(
    '45678901-4567-4567-8567-456789012345',
    'retry_local'
  ),
  true,
  'notebook conflict can retry current name and parent'
);
select is(
  (select count(*) from public.drive_sync_jobs where idempotency_key like 'resolution:45678901-4567-4567-8567-456789012345:%'),
  2::bigint,
  'notebook retry creates independent rename and move jobs'
);
select is(
  (select drive_sync_status::text from public.notebooks where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'pending',
  'notebook returns to pending state'
);

insert into public.drive_sync_jobs (
  id,
  user_id,
  operation,
  status,
  notebook_id,
  drive_file_id,
  idempotency_key,
  payload,
  finished_at
) values (
  '56789012-5678-4678-8678-567890123456',
  '11111111-1111-4111-8111-111111111111',
  'rename_folder',
  'conflict',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '0ABiologyFolderId_123456789',
  'conflict-notebook-missing-job',
  '{"outcome":"conflict"}'::jsonb,
  timezone('utc', now())
);
insert into public.drive_conflicts (
  id,
  user_id,
  job_id,
  notebook_id,
  kind,
  local_snapshot,
  remote_snapshot
) values (
  '67890123-6789-4789-8789-678901234567',
  '11111111-1111-4111-8111-111111111111',
  '56789012-5678-4678-8678-567890123456',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'remote_deleted_local_changed',
  '{"name":"Biologia"}'::jsonb,
  '{"removed":true}'::jsonb
);
select throws_ok(
  $$ select public.resolve_drive_conflict('67890123-6789-4789-8789-678901234567', 'mark_missing') $$,
  '22023',
  null,
  'mark_missing is restricted to document originals'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  public.resolve_drive_conflict(
    '67890123-6789-4789-8789-678901234567',
    'retry_local'
  ),
  false,
  'another authorized user cannot resolve the owner conflict'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$ select public.resolve_drive_conflict('67890123-6789-4789-8789-678901234567', 'retry_local') $$,
  '42501',
  null,
  'anonymous callers cannot resolve Drive conflicts'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*) from public.drive_conflicts where resolved_at is not null),
  3::bigint,
  'only successful owner resolutions receive receipts'
);
select is(
  (select count(*) from public.drive_conflicts where resolved_at is null),
  1::bigint,
  'invalid notebook missing resolution remains open'
);

select * from finish();
rollback;
