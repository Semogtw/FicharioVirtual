begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'drive-runner@example.test');
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
  'google-subject-runner',
  'drive-runner@example.test',
  '0ARootFolderId_123456789',
  'start-token'
);

insert into public.notebooks (id, user_id, name)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Biologia'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table first_claim as
select *
from public.claim_drive_sync_job_for_user(
  '11111111-1111-4111-8111-111111111111',
  'worker-a',
  60
);

select is((select count(*) from first_claim), 1::bigint, 'one runnable job is claimed');
select is((select operation::text from first_claim), 'create_folder', 'folder creation is claimed first');
select is((select attempt_count from first_claim), 1, 'claim increments the attempt counter');
select ok((select lease_expires_at > timezone('utc', now()) from first_claim), 'claim receives a future lease');

select is_empty(
  $$
    select *
    from public.claim_drive_sync_job_for_user(
      '11111111-1111-4111-8111-111111111111',
      'worker-b',
      60
    )
  $$,
  'a live lease prevents a second worker claim'
);

select is(
  public.complete_drive_sync_job(
    '11111111-1111-4111-8111-111111111111',
    (select id from first_claim),
    'worker-b',
    '0ABiologyFolderId_123456789',
    '0ARootFolderId_123456789',
    '2026-08-06T13:30:00Z',
    '1',
    null
  ),
  false,
  'a stale worker cannot complete another worker lease'
);

select is(
  public.complete_drive_sync_job(
    '11111111-1111-4111-8111-111111111111',
    (select id from first_claim),
    'worker-a',
    '0ABiologyFolderId_123456789',
    '0ARootFolderId_123456789',
    '2026-08-06T13:30:00Z',
    '1',
    null
  ),
  true,
  'lease owner completes the folder creation'
);

select results_eq(
  $$
    select drive_folder_id, drive_version, drive_sync_status::text
    from public.notebooks
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  $$,
  $$ values ('0ABiologyFolderId_123456789'::text, '1'::text, 'synced'::text) $$,
  'folder completion publishes Drive identity and sync receipt'
);
select is(
  (select status::text from public.drive_sync_jobs where id = (select id from first_claim)),
  'synced',
  'completed job is terminal'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
update public.notebooks
set name = 'Ciências Biológicas'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
create temporary table rename_claim as
select *
from public.claim_drive_sync_job_for_user(
  '11111111-1111-4111-8111-111111111111',
  'worker-a',
  30
);
select is((select operation::text from rename_claim), 'rename_folder', 'rename job is claimed');

select is(
  public.retry_drive_sync_job(
    '11111111-1111-4111-8111-111111111111',
    (select id from rename_claim),
    'worker-a',
    'drive_rate_limited',
    'Google Drive temporariamente indisponível.'
  ),
  true,
  'transient provider failure schedules a retry'
);
select results_eq(
  $$
    select status::text, lease_owner, lease_expires_at, next_retry_at > timezone('utc', now()), last_error_code
    from public.drive_sync_jobs
    where id = (select id from rename_claim)
  $$,
  $$ values ('retryable'::text, null::text, null::timestamptz, true, 'drive_rate_limited'::text) $$,
  'retry clears the lease and stores sanitized backoff state'
);

update public.drive_sync_jobs
set next_retry_at = timezone('utc', now()) - interval '1 second'
where id = (select id from rename_claim);
create temporary table retry_claim as
select *
from public.claim_drive_sync_job_for_user(
  '11111111-1111-4111-8111-111111111111',
  'worker-c',
  30
);
select is((select id from retry_claim), (select id from rename_claim), 'retryable job is reclaimed');
select is((select attempt_count from retry_claim), 2, 'reclaim increments attempts again');

select is(
  public.complete_drive_sync_job(
    '11111111-1111-4111-8111-111111111111',
    (select id from retry_claim),
    'worker-c',
    '0ABiologyFolderId_123456789',
    '0ARootFolderId_123456789',
    '2026-08-06T13:35:00Z',
    '2',
    null
  ),
  true,
  'retried rename can complete normally'
);
select is(
  (select drive_sync_status::text from public.notebooks where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'synced',
  'successful retry clears the entity pending state'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
update public.notebooks
set name = 'Nome impossível'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
create temporary table conflict_claim as
select *
from public.claim_drive_sync_job_for_user(
  '11111111-1111-4111-8111-111111111111',
  'worker-d',
  30
);

select is(
  public.conflict_drive_sync_job(
    '11111111-1111-4111-8111-111111111111',
    (select id from conflict_claim),
    'worker-d',
    'identity_mismatch',
    '{"name":"Nome impossível"}'::jsonb,
    '{"mimeType":"application/pdf"}'::jsonb
  ),
  true,
  'irreconcilable local mutation becomes an isolated conflict'
);
select is(
  (select status::text from public.drive_sync_jobs where id = (select id from conflict_claim)),
  'conflict',
  'conflicted job is terminal'
);
select is(
  (select count(*) from public.drive_conflicts where job_id = (select id from conflict_claim)),
  1::bigint,
  'one conflict receipt is recorded'
);
select is(
  (select drive_sync_status::text from public.notebooks where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'conflict',
  'only the related notebook is marked conflicted'
);

insert into public.drive_sync_jobs (
  id,
  user_id,
  operation,
  status,
  drive_file_id,
  idempotency_key,
  payload,
  lease_owner,
  lease_expires_at,
  attempt_count
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  'delete_permanently',
  'processing',
  '9DeleteDriveFileId_123456789',
  'runner-expired-delete-job',
  '{"targetKind":"file"}'::jsonb,
  'dead-worker',
  timezone('utc', now()) - interval '1 second',
  1
);

create temporary table expired_claim as
select *
from public.claim_drive_sync_job_for_user(
  '11111111-1111-4111-8111-111111111111',
  'worker-e',
  30
);
select is((select id from expired_claim), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'expired processing lease is reclaimed');
select is((select attempt_count from expired_claim), 2, 'reclaimed abandoned work increments attempts');

select is(
  public.complete_drive_sync_job(
    '11111111-1111-4111-8111-111111111111',
    (select id from expired_claim),
    'worker-e',
    null,
    null,
    null,
    null,
    null
  ),
  true,
  'physical deletion job completes without a surviving domain row'
);
select is(
  (select status::text from public.drive_sync_jobs where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'synced',
  'deletion receipt remains durable'
);

select * from finish();
rollback;
