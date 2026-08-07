begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('public', 'ocr_batches', 'OCR batch manifests are persisted');
select has_function(
  'public',
  'claim_ocr_job',
  array['uuid', 'text', 'timestamp with time zone'],
  'provider-only three-argument claim exists'
);
select hasnt_function(
  'public',
  'claim_ocr_job',
  array['uuid', 'text', 'timestamp with time zone', 'integer'],
  'application daily-limit claim signature was removed'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.register_ocr_batch(uuid,text,uuid[],integer[],bigint,bigint,integer,uuid,text,integer,timestamp with time zone)',
    'execute'
  ),
  'authenticated users can register validated batch manifests'
);
select ok(
  not has_table_privilege('authenticated', 'public.ocr_batches', 'insert'),
  'authenticated users cannot bypass the validated batch RPC with direct inserts'
);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'batch-owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'batch-other@example.test');

insert into public.app_users (
  user_id,
  is_active,
  ocr_consent_at,
  ocr_consent_version
) values
  (
    '11111111-1111-4111-8111-111111111111',
    true,
    '2026-08-06T00:00:00Z',
    1
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    true,
    '2026-08-06T00:00:00Z',
    1
  );

insert into public.documents (
  id, user_id, title, kind, original_filename, storage_path, page_count, status
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'Owner batch',
    'pdf',
    'owner.pdf',
    '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original.pdf',
    2,
    'processing'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'Other batch',
    'pdf',
    'other.pdf',
    '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original.pdf',
    1,
    'processing'
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
    'pending'
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    1,
    'pending'
  );

insert into public.ocr_jobs (
  id, user_id, page_id, status, attempt_count, idempotency_key
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001',
    'pending',
    0,
    'batch-owner-page-1'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000002',
    'pending',
    0,
    'batch-owner-page-2'
  ),
  (
    '40000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    '20000000-0000-4000-8000-000000000001',
    'pending',
    0,
    'batch-other-page-1'
  );

insert into public.usage_daily (
  user_id, usage_date, ocr_pages, ocr_batches, ocr_calls, ocr_attempts
) values (
  '11111111-1111-4111-8111-111111111111',
  '2026-08-06',
  999999,
  0,
  0,
  999999
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is(
  public.claim_ocr_job(
    '10000000-0000-4000-8000-000000000001'::uuid,
    'gemini-test',
    '2026-08-06T12:00:00Z'::timestamptz
  )->>'state',
  'claimed',
  'a high informational counter does not block a provider-bound claim'
);

create temporary table registered_batch (id uuid not null);
insert into registered_batch (id)
select public.register_ocr_batch(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'gemini',
  array[
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid
  ],
  array[1, 2],
  0,
  1048576,
  0,
  null,
  'gemini-test',
  1,
  '2026-08-06T12:00:01Z'::timestamptz
);

select is(
  (select count(*)::integer from registered_batch),
  1,
  'a validated batch manifest is registered'
);
select results_eq(
  $$
    select page_ids, page_numbers, derived_bytes, split_depth, route
    from public.ocr_batches
    where id = (select id from registered_batch)
  $$,
  $$
    values (
      array[
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000002'::uuid
      ],
      array[1, 2],
      1048576::bigint,
      0,
      'gemini'::text
    )
  $$,
  'manifest preserves exact page order and derived bytes'
);
select results_eq(
  $$
    select page_id, batch_ordinal
    from public.ocr_jobs
    where batch_id = (select id from registered_batch)
    order by batch_ordinal
  $$,
  $$
    values
      ('10000000-0000-4000-8000-000000000001'::uuid, 1),
      ('10000000-0000-4000-8000-000000000002'::uuid, 2)
  $$,
  'jobs are linked to the manifest in original order'
);
select ok(
  public.record_ocr_batch_call(
    (select id from registered_batch),
    2,
    '2026-08-06T12:00:02Z'::timestamptz
  ),
  'one provider call is recorded for the batch'
);
select results_eq(
  $$
    select ocr_pages, ocr_batches, ocr_calls, ocr_attempts
    from public.usage_daily
    where user_id = '11111111-1111-4111-8111-111111111111'::uuid
      and usage_date = '2026-08-06'::date
  $$,
  $$ values (1000000, 1, 1, 1000000) $$,
  'usage counters remain informational and distinguish pages, batches, calls and attempts'
);
select ok(
  public.finish_ocr_batch(
    (select id from registered_batch),
    'ready',
    null,
    null,
    null,
    '2026-08-06T12:00:03Z'::timestamptz
  ),
  'a completed batch reaches a terminal state through the RPC'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is_empty(
  $$ select id from public.ocr_batches $$,
  'another authorized owner cannot read batch manifests'
);
select is(
  public.finish_ocr_batch(
    (select id from registered_batch),
    'failed',
    'foreign_attempt',
    'Should not update',
    null,
    '2026-08-06T12:00:04Z'::timestamptz
  ),
  false,
  'another owner cannot mutate a batch through the RPC'
);

select * from finish();
rollback;
