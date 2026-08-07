begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'local-queue@example.test');
insert into public.app_users (user_id, is_active)
values ('11111111-1111-4111-8111-111111111111', true);

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
  'google-subject-local-queue',
  'local-queue@example.test',
  '0ARootFolderId_123456789',
  'start-token'
);

insert into public.notebooks (
  id,
  user_id,
  name
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Biologia'
);

select is(
  (select count(*) from public.drive_sync_jobs where operation = 'create_folder'),
  1::bigint,
  'creating a local notebook enqueues one Drive folder creation'
);
select results_eq(
  $$
    select notebook_id, status::text, payload ->> 'name', payload ->> 'parentNotebookId'
    from public.drive_sync_jobs
    where operation = 'create_folder'
  $$,
  $$ values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'pending'::text,
    'Biologia'::text,
    null::text
  ) $$,
  'folder creation job captures the desired local state'
);
select is(
  (select drive_sync_status::text from public.notebooks where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'pending',
  'new notebook remains pending until the Drive folder exists'
);

update public.notebooks
set
  drive_folder_id = '0ABiologyFolderId_123456789',
  drive_modified_time = '2026-08-06T12:30:00Z',
  drive_version = '1',
  drive_sync_status = 'synced'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (select count(*) from public.drive_sync_jobs),
  1::bigint,
  'publishing a Drive identity alone does not enqueue another local job'
);

update public.notebooks
set name = 'Ciências Biológicas'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (select count(*) from public.drive_sync_jobs where operation = 'rename_folder'),
  1::bigint,
  'renaming a synced notebook enqueues one folder rename'
);
select is(
  (select payload ->> 'name' from public.drive_sync_jobs where operation = 'rename_folder'),
  'Ciências Biológicas',
  'rename job captures the latest desired name'
);
select is(
  (select drive_sync_status::text from public.notebooks where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'pending',
  'renamed notebook is visibly pending'
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
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  '2026',
  '0AYearFolderId_123456789',
  '2026-08-06T12:35:00Z',
  '1',
  'synced'
);

select is(
  (select count(*) from public.drive_sync_jobs where notebook_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0::bigint,
  'inserting an already published folder does not enqueue creation'
);

update public.notebooks
set parent_notebook_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (select count(*) from public.drive_sync_jobs where operation = 'move_folder'),
  1::bigint,
  'moving a notebook enqueues one folder move'
);
select results_eq(
  $$
    select drive_file_id, payload ->> 'parentNotebookId'
    from public.drive_sync_jobs
    where operation = 'move_folder'
  $$,
  $$ values (
    '0ABiologyFolderId_123456789'::text,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text
  ) $$,
  'folder move keeps Drive identity and desired parent entity'
);

select *
from public.create_drive_image_import(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Fotossíntese',
  'fotossintese.webp',
  '1DriveDocumentFileId_123456789',
  '0ABiologyFolderId_123456789',
  'image/webp',
  '2026-08-06T12:40:00Z',
  '1',
  'd41d8cd98f00b204e9800998ecf8427e',
  '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc/thumbnail.jpg',
  repeat('a', 64),
  null,
  1
);

select is(
  (select count(*) from public.drive_sync_jobs where document_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  0::bigint,
  'Drive-first import does not enqueue a redundant upload job'
);

update public.documents
set notebook_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select is(
  (select count(*) from public.drive_sync_jobs where operation = 'update_file'),
  1::bigint,
  'moving a local document enqueues one Drive file update'
);
select results_eq(
  $$
    select document_id, drive_file_id, payload ->> 'notebookId'
    from public.drive_sync_jobs
    where operation = 'update_file'
  $$,
  $$ values (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
    '1DriveDocumentFileId_123456789'::text,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::text
  ) $$,
  'file move job captures the destination notebook'
);
select is(
  (select drive_sync_status::text from public.documents where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'pending',
  'moved document is visibly pending'
);

select set_config('request.jwt.claim.role', 'service_role', true);
update public.documents
set
  drive_modified_time = '2026-08-06T12:45:00Z',
  drive_version = '2',
  drive_sync_status = 'synced'
where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
update public.notebooks
set name = 'Nome remoto'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (select count(*) from public.drive_sync_jobs where operation = 'rename_folder'),
  1::bigint,
  'service-role remote application does not echo a second rename job'
);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table deleted_document_receipt as
select drive_file_id from public.documents where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
delete from public.documents
where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select is(
  (select count(*) from public.drive_sync_jobs where operation = 'delete_permanently' and drive_file_id = '1DriveDocumentFileId_123456789'),
  1::bigint,
  'deleting a local document preserves one independent Drive deletion job'
);
select is(
  (select document_id from public.drive_sync_jobs where operation = 'delete_permanently' and drive_file_id = '1DriveDocumentFileId_123456789'),
  null,
  'file deletion job survives the document row deletion'
);
select is(
  (select payload ->> 'targetKind' from public.drive_sync_jobs where operation = 'delete_permanently' and drive_file_id = '1DriveDocumentFileId_123456789'),
  'file',
  'file deletion job identifies its physical target kind'
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
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  '11111111-1111-4111-8111-111111111111',
  'Descartável',
  '0ADeleteFolderId_123456789',
  '2026-08-06T12:50:00Z',
  '1',
  'synced'
);
delete from public.notebooks
where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

select is(
  (select count(*) from public.drive_sync_jobs where operation = 'delete_permanently' and drive_file_id = '0ADeleteFolderId_123456789'),
  1::bigint,
  'deleting a local notebook preserves one independent folder deletion job'
);
select is(
  (select notebook_id from public.drive_sync_jobs where operation = 'delete_permanently' and drive_file_id = '0ADeleteFolderId_123456789'),
  null,
  'folder deletion job survives the notebook row deletion'
);
select is(
  (select payload ->> 'targetKind' from public.drive_sync_jobs where operation = 'delete_permanently' and drive_file_id = '0ADeleteFolderId_123456789'),
  'folder',
  'folder deletion job identifies its physical target kind'
);

select is(
  (select count(*) from public.drive_sync_jobs where status in ('pending', 'retryable', 'processing')),
  5::bigint,
  'entity-bound work is superseded on deletion while independent Drive deletion receipts remain queued'
);

select * from finish();
rollback;
