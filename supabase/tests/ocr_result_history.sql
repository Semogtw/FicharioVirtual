begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'ocr-result-history@example.test');
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
  'ocr-result-history-google-subject',
  'ocr-result-history@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

select public.stage_drive_pdf_reference(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  null,
  'PDF para histórico OCR',
  'ocr-result-history.pdf',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  '0ARootFolderId_123456789',
  '2026-08-08T12:00:00Z',
  '7',
  'd41d8cd98f00b204e9800998ecf8427e',
  125829120,
  '2026-08-08T12:00:00Z'
);

select public.begin_drive_pdf_reference_descriptor_attempt(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  1
);

select public.stage_drive_pdf_reference_descriptor_batch(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'pageNumber', 1,
      'nativeText', null,
      'needsOcr', true,
      'temporaryImagePath', '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/pages/1.webp',
      'jobId', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    )
  )
);

select public.finalize_drive_pdf_reference_descriptor_attempt(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  3
);

reset role;
update public.pages
   set status = 'processing'::public.page_status
 where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
update public.ocr_jobs
   set status = 'processing'::public.ocr_status,
       model = 'gemini-2.5-flash'
 where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select ok(
  has_table_privilege('authenticated', 'public.ocr_results', 'SELECT'),
  'authenticated users may read their OCR result history'
);
select ok(
  not has_table_privilege('authenticated', 'public.ocr_results', 'INSERT'),
  'authenticated users may not insert OCR results directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.ocr_results', 'UPDATE'),
  'authenticated users may not mutate OCR results directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.ocr_results', 'DELETE'),
  'authenticated users may not delete OCR results directly'
);

select lives_ok(
  $$
    select public.complete_ocr_job(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Texto OCR persistido',
      '["low_contrast"]'::jsonb,
      'needs_review'::public.page_status,
      '2026-08-08T12:05:00Z'::timestamptz
    )
  $$,
  'OCR completion persists an immutable result and keeps the existing page summary'
);

select results_eq(
  $$
    select provider, model, raw_text, corrected_text, content_type, mean_confidence, warnings,
           metadata ->> 'source'
      from public.ocr_results
     where page_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  $$,
  $$
    values (
      'gemini'::text,
      'gemini-2.5-flash'::text,
      'Texto OCR persistido'::text,
      null::text,
      'unknown'::text,
      null::numeric,
      '["low_contrast"]'::jsonb,
      'complete_ocr_job'::text
    )
  $$,
  'persisted result records provider/model provenance and immutable OCR payload'
);

select results_eq(
  $$
    select page.ocr_raw_text,
           page.corrected_text,
           page.warnings,
           page.status::text,
           page.extraction_source::text,
           (page.accepted_ocr_result_id = result.id)
      from public.pages as page
      join public.ocr_results as result
        on result.page_id = page.id
       and result.user_id = page.user_id
     where page.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  $$,
  $$
    values (
      'Texto OCR persistido'::text,
      null::text,
      '["low_contrast"]'::jsonb,
      'needs_review'::text,
      'ocr'::text,
      true::boolean
    )
  $$,
  'page summary remains compatible and points at its accepted immutable result'
);

select lives_ok(
  $$
    select public.complete_ocr_job(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Texto OCR persistido',
      '["low_contrast"]'::jsonb,
      'needs_review'::public.page_status,
      '2026-08-08T12:05:00Z'::timestamptz
    )
  $$,
  'an exact completion retry remains idempotent'
);

reset role;
select is(
  (select count(*) from public.ocr_results where ocr_job_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  1::bigint,
  'an exact completion retry does not duplicate immutable results'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select throws_ok(
  $$
    select public.complete_ocr_job(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Texto conflitante',
      '["low_contrast"]'::jsonb,
      'needs_review'::public.page_status,
      '2026-08-08T12:05:00Z'::timestamptz
    )
  $$,
  '22023',
  'OCR completion conflicts with the persisted result',
  'a conflicting retry cannot rewrite OCR result history'
);

select throws_ok(
  $$
    insert into public.ocr_results (
      user_id,
      page_id,
      ocr_job_id,
      provider,
      model,
      raw_text,
      content_type
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'gemini',
      'gemini-2.5-flash',
      'write must be rejected',
      'unknown'
    )
  $$,
  '42501',
  null,
  'authenticated clients cannot bypass the completion RPC with direct inserts'
);

reset role;
insert into auth.users (id, email)
values ('22222222-2222-4222-8222-222222222222', 'other-ocr-result@example.test');
insert into public.app_users (user_id, is_active)
values ('22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is(
  (select count(*) from public.ocr_results),
  0::bigint,
  'RLS hides OCR result history from other users'
);

reset role;
select ok(
  (select count(*) from public.ocr_results where page_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') = 1,
  'database owner still sees the immutable result after RLS isolation checks'
);
select ok(
  (select accepted_ocr_result_id is not null from public.pages where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'accepted-result pointer remains durable'
);
select ok(
  (select status = 'ready'::public.ocr_status from public.ocr_jobs where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  'job terminal status remains compatible with the existing OCR pipeline'
);

select * from finish();
rollback;
