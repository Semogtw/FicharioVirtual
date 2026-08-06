begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select is(
  (
    select constraint_record.confdeltype::text
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conname = 'ocr_jobs_batch_id_fkey'
      and constraint_record.conrelid = 'public.ocr_jobs'::regclass
  ),
  'r',
  'OCR jobs restrict deletion of referenced immutable batch manifests'
);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'batch-manifest@example.test');
insert into public.app_users (user_id, is_active, ocr_consent_at, ocr_consent_version)
values (
  '11111111-1111-4111-8111-111111111111', true, '2026-08-06T00:00:00Z', 1
);
insert into public.documents (
  id, user_id, title, kind, original_filename, storage_path, page_count, status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Manifest integrity',
  'pdf',
  'manifest.pdf',
  '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original.pdf',
  2,
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
  );
insert into public.ocr_jobs (id, user_id, page_id, status, idempotency_key)
values (
  '30000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-000000000001',
  'pending',
  'manifest-page-1'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is(
  public.register_ocr_batch(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'gemini',
    array[
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid
    ],
    array[1, 2],
    0,
    2048,
    0,
    null,
    'gemini-test',
    1,
    '2026-08-06T12:00:00Z'::timestamptz
  ),
  null,
  'a batch is rejected when any requested page has no OCR job'
);
select is(
  (select count(*)::integer from public.ocr_batches),
  0,
  'a rejected batch leaves no partial manifest'
);

reset role;
insert into public.ocr_jobs (id, user_id, page_id, status, idempotency_key)
values (
  '30000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-000000000002',
  'pending',
  'manifest-page-2'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is(
  public.register_ocr_batch(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    'gemini',
    array[
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid
    ],
    array[2, 1],
    0,
    2048,
    0,
    null,
    'gemini-test',
    1,
    '2026-08-06T12:00:01Z'::timestamptz
  ),
  null,
  'a batch is rejected when page numbers do not match page IDs by ordinal'
);
select is(
  (select count(*)::integer from public.ocr_batches),
  0,
  'an order mismatch leaves no partial manifest'
);

create temporary table valid_manifest (id uuid not null);
insert into valid_manifest (id)
select public.register_ocr_batch(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'gemini',
  array[
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid
  ],
  array[1, 2],
  0,
  2048,
  0,
  null,
  'gemini-test',
  1,
  '2026-08-06T12:00:02Z'::timestamptz
);

select ok(
  (select id is not null from valid_manifest),
  'a complete page/job set creates a batch'
);
select is(
  (
    select count(*)::integer
    from public.ocr_jobs j
    where j.batch_id = (select id from valid_manifest)
  ),
  2,
  'every requested job is linked to the manifest'
);
select is(
  (
    select array_agg(j.batch_ordinal order by j.batch_ordinal)
    from public.ocr_jobs j
    where j.batch_id = (select id from valid_manifest)
  ),
  array[1, 2],
  'job ordinals preserve the requested page order'
);

select ok(
  public.finish_ocr_batch(
    (select id from valid_manifest),
    'retryable',
    'ocr_batch_split_required',
    'Retry the affected subset.',
    '2026-08-06T12:05:00Z'::timestamptz,
    '2026-08-06T12:00:03Z'::timestamptz
  ),
  'a parent batch can become retryable before a split'
);

create temporary table child_manifest (id uuid not null);
insert into child_manifest (id)
select public.register_ocr_batch(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'gemini',
  array[
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid
  ],
  array[1, 2],
  0,
  2048,
  1,
  null,
  'gemini-test',
  1,
  '2026-08-06T12:05:01Z'::timestamptz
);

select ok(
  (select id is not null from child_manifest),
  'retryable jobs can be linked to a child batch'
);
select is(
  (
    select b.parent_batch_id
    from public.ocr_batches b
    where b.id = (select id from child_manifest)
  ),
  (select id from valid_manifest),
  'a single prior retryable batch is inferred as the child parent'
);
select is(
  (
    select count(*)::integer
    from public.ocr_jobs j
    where j.batch_id = (select id from child_manifest)
  ),
  2,
  'retryable jobs are relinked to the child manifest'
);

select * from finish();
rollback;
