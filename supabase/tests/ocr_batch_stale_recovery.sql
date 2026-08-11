begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'stale-batch@example.test');
insert into public.app_users (user_id, is_active)
values ('11111111-1111-4111-8111-111111111111', true);
insert into public.documents (
  id, user_id, title, kind, original_filename, storage_path, page_count, status
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Stale batches',
  'pdf',
  'stale.pdf',
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
    'processing'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    2,
    'processing'
  );
insert into public.ocr_batches (
  id, user_id, document_id, route, status, page_ids, page_numbers,
  derived_bytes, model, prompt_version, started_at
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'gemini',
    'processing',
    array['10000000-0000-4000-8000-000000000001'::uuid],
    array[1],
    1024,
    'gemini-test',
    1,
    timezone('utc', now()) - interval '20 minutes'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'gemini',
    'processing',
    array['10000000-0000-4000-8000-000000000002'::uuid],
    array[2],
    1024,
    'gemini-test',
    1,
    timezone('utc', now()) - interval '5 minutes'
  );
insert into public.ocr_jobs (
  id, user_id, page_id, status, idempotency_key, attempt_count,
  started_at, batch_id, batch_ordinal
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001',
    'processing',
    'stale-batch-page-1',
    1,
    timezone('utc', now()) - interval '20 minutes',
    '20000000-0000-4000-8000-000000000001',
    1
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000002',
    'processing',
    'fresh-batch-page-2',
    1,
    timezone('utc', now()) - interval '5 minutes',
    '20000000-0000-4000-8000-000000000002',
    1
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is(
  public.recover_stale_ocr_jobs(),
  1,
  'only OCR jobs older than the stale threshold are recovered'
);
select is(
  (select status::text from public.ocr_jobs where id = '30000000-0000-4000-8000-000000000001'),
  'retryable',
  'the stale OCR job becomes retryable'
);
select is(
  (select last_error_code from public.ocr_jobs where id = '30000000-0000-4000-8000-000000000001'),
  'stale_processing_claim',
  'the stale OCR job records a safe recovery code'
);
select is(
  (select status::text from public.pages where id = '10000000-0000-4000-8000-000000000001'),
  'retryable',
  'the stale page becomes retryable'
);
select is(
  (select status::text from public.ocr_batches where id = '20000000-0000-4000-8000-000000000001'),
  'retryable',
  'the stale batch manifest becomes retryable'
);
select is(
  (select last_error_code from public.ocr_batches where id = '20000000-0000-4000-8000-000000000001'),
  'stale_processing_claim',
  'the stale batch records the same safe recovery code'
);
select ok(
  (select next_retry_at is not null from public.ocr_batches where id = '20000000-0000-4000-8000-000000000001'),
  'the stale batch is immediately eligible for controlled retry'
);
select is(
  (select status::text from public.ocr_jobs where id = '30000000-0000-4000-8000-000000000002'),
  'processing',
  'a fresh OCR job remains processing'
);
select is(
  (select status::text from public.ocr_batches where id = '20000000-0000-4000-8000-000000000002'),
  'processing',
  'a fresh OCR batch remains processing'
);

select * from finish();
rollback;
