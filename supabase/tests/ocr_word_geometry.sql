begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(
  public.is_valid_ocr_word_geometry('[ ["fotossintcse",1200,2400,3500,2900] ]'::jsonb),
  'normalized OCR word geometry accepts a bounded word box'
);
select ok(
  not public.is_valid_ocr_word_geometry('[ ["fora",9000,100,10001,500] ]'::jsonb),
  'normalized OCR word geometry rejects coordinates outside the page grid'
);

insert into auth.users (id, email)
values ('81111111-1111-4111-8111-111111111111', 'ocr-geometry@example.test');
insert into public.app_users (user_id, is_active)
values ('81111111-1111-4111-8111-111111111111', true);
insert into public.documents (
  id, user_id, title, kind, original_filename, storage_path, page_count, status
) values (
  '82222222-2222-4222-8222-222222222222',
  '81111111-1111-4111-8111-111111111111',
  'Geometria OCR',
  'image',
  'geometria.webp',
  '81111111-1111-4111-8111-111111111111/geometria.webp',
  1,
  'processing'
);
insert into public.pages (
  id, user_id, document_id, page_number, status
) values (
  '83333333-3333-4333-8333-333333333333',
  '81111111-1111-4111-8111-111111111111',
  '82222222-2222-4222-8222-222222222222',
  1,
  'processing'::public.page_status
);
insert into public.ocr_jobs (
  id, user_id, page_id, provider, model, prompt_version, status, idempotency_key
) values (
  '84444444-4444-4444-8444-444444444444',
  '81111111-1111-4111-8111-111111111111',
  '83333333-3333-4333-8333-333333333333',
  'gemini',
  'gemini-test',
  1,
  'processing'::public.ocr_status,
  'ocr-geometry-test-job-0001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81111111-1111-4111-8111-111111111111', true);

select ok(
  not has_function_privilege('authenticated', 'public.is_valid_ocr_word_geometry(jsonb)', 'EXECUTE'),
  'geometry validator is not exposed as a client RPC'
);

select lives_ok(
  $$
    select public.complete_ocr_job_with_geometry(
      '83333333-3333-4333-8333-333333333333',
      'A fotossintcse transforma energia.',
      '[]'::jsonb,
      'ready'::public.page_status,
      '2026-08-10T11:15:00Z'::timestamptz,
      '[["fotossintcse",1200,2400,3500,2900]]'::jsonb
    )
  $$,
  'Gemini completion atomically persists OCR text and normalized word geometry'
);

select results_eq(
  $$
    select ocr_raw_text, ocr_word_geometry
      from public.pages
     where id = '83333333-3333-4333-8333-333333333333'
  $$,
  $$
    values (
      'A fotossintcse transforma energia.'::text,
      '[["fotossintcse",1200,2400,3500,2900]]'::jsonb
    )
  $$,
  'page summary carries the geometry used by the document viewer'
);

select results_eq(
  $$
    select result.word_geometry
      from public.ocr_results as result
      join public.pages as page on page.accepted_ocr_result_id = result.id
     where page.id = '83333333-3333-4333-8333-333333333333'
  $$,
  $$ values ('[["fotossintcse",1200,2400,3500,2900]]'::jsonb) $$,
  'immutable accepted OCR result owns the same geometry'
);

select lives_ok(
  $$
    select public.complete_ocr_job_with_geometry(
      '83333333-3333-4333-8333-333333333333',
      'A fotossintcse transforma energia.',
      '[]'::jsonb,
      'ready'::public.page_status,
      '2026-08-10T11:15:00Z'::timestamptz,
      '[["fotossintcse",1200,2400,3500,2900]]'::jsonb
    )
  $$,
  'an exact OCR geometry replay remains idempotent'
);

select throws_ok(
  $$
    select public.complete_ocr_job_with_geometry(
      '83333333-3333-4333-8333-333333333333',
      'A fotossintcse transforma energia.',
      '[]'::jsonb,
      'ready'::public.page_status,
      '2026-08-10T11:15:00Z'::timestamptz,
      '[["fotossintcse",1300,2400,3500,2900]]'::jsonb
    )
  $$,
  '22023',
  'OCR word geometry conflicts with the persisted result',
  'a replay cannot silently move accepted word boxes'
);

select throws_ok(
  $$
    update public.ocr_results
       set word_geometry = '[]'::jsonb
     where page_id = '83333333-3333-4333-8333-333333333333'
  $$,
  '42501',
  null,
  'authenticated clients cannot rewrite immutable OCR geometry directly'
);

select * from finish();
rollback;
