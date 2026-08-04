begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_function(
  'public',
  'list_runnable_ocr_jobs',
  array['timestamp with time zone', 'integer'],
  'bounded runnable OCR queue exists'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.list_runnable_ocr_jobs(timestamp with time zone,integer)',
    'execute'
  ),
  'anonymous callers cannot inspect the OCR queue'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.list_runnable_ocr_jobs(timestamp with time zone,integer)',
    'execute'
  ),
  'authenticated callers may inspect their OCR queue'
);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'queue-owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'queue-other@example.test');

insert into public.app_users (user_id, is_active)
values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true);

insert into public.documents (
  id,
  user_id,
  title,
  kind,
  original_filename,
  storage_path,
  page_count,
  status
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'Owner queue',
    'pdf',
    'owner.pdf',
    '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original.pdf',
    5,
    'processing'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'Other queue',
    'image',
    'other.webp',
    '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original.webp',
    1,
    'pending'
  );

insert into public.pages (id, user_id, document_id, page_number, status)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    1,
    'pending'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    2,
    'retryable'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    3,
    'retryable'
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    4,
    'pending'
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    5,
    'processing'
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    1,
    'pending'
  );

insert into public.ocr_jobs (
  id,
  user_id,
  page_id,
  status,
  attempt_count,
  idempotency_key,
  next_retry_at,
  started_at,
  created_at,
  updated_at
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001',
    'pending',
    0,
    'queue-owner-page-0001',
    null,
    null,
    timezone('utc', now()) - interval '30 minutes',
    timezone('utc', now()) - interval '30 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000002',
    'retryable',
    1,
    'queue-owner-page-0002',
    timezone('utc', now()) + interval '1 day',
    null,
    timezone('utc', now()) - interval '25 minutes',
    timezone('utc', now()) - interval '25 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000003',
    'retryable',
    2,
    'queue-owner-page-0003',
    timezone('utc', now()) - interval '10 minutes',
    null,
    timezone('utc', now()) - interval '20 minutes',
    timezone('utc', now()) - interval '10 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000004',
    'pending',
    3,
    'queue-owner-page-0004',
    null,
    null,
    timezone('utc', now()) - interval '15 minutes',
    timezone('utc', now()) - interval '15 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000005',
    'processing',
    1,
    'queue-owner-page-0005',
    null,
    timezone('utc', now()) - interval '16 minutes',
    timezone('utc', now()) - interval '40 minutes',
    timezone('utc', now()) - interval '16 minutes'
  ),
  (
    '40000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    '20000000-0000-4000-8000-000000000001',
    'pending',
    0,
    'queue-other-page-0001',
    null,
    null,
    timezone('utc', now()) - interval '1 hour',
    timezone('utc', now()) - interval '1 hour'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is(
  public.recover_stale_ocr_jobs(),
  1,
  'stale processing claims return to the retryable queue'
);

select results_eq(
  $$
    select page_id, attempt_count
    from public.list_runnable_ocr_jobs(timezone('utc', now()) + interval '1 minute', 50)
  $$,
  $$
    values
      ('10000000-0000-4000-8000-000000000001'::uuid, 0),
      ('10000000-0000-4000-8000-000000000003'::uuid, 2),
      ('10000000-0000-4000-8000-000000000005'::uuid, 1)
  $$,
  'owner receives only due work below the automatic attempt ceiling'
);

select results_eq(
  $$
    select page_id
    from public.list_runnable_ocr_jobs(timezone('utc', now()) + interval '1 minute', 1)
  $$,
  $$ values ('10000000-0000-4000-8000-000000000001'::uuid) $$,
  'queue selection enforces the requested batch limit'
);

select is_empty(
  $$
    select page_id
    from public.list_runnable_ocr_jobs(timezone('utc', now()) + interval '1 minute', 50)
    where page_id in (
      '10000000-0000-4000-8000-000000000002'::uuid,
      '10000000-0000-4000-8000-000000000004'::uuid,
      '20000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  'future retries, exhausted automatic attempts and other owners stay hidden'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select results_eq(
  $$
    select page_id, attempt_count
    from public.list_runnable_ocr_jobs(timezone('utc', now()) + interval '1 minute', 50)
  $$,
  $$ values ('20000000-0000-4000-8000-000000000001'::uuid, 0) $$,
  'another owner receives only their own runnable work'
);

select * from finish();
rollback;
