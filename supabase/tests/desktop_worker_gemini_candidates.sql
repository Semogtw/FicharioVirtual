begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email)
values
  ('b1111111-1111-4111-8111-111111111111', 'candidate-owner@example.test'),
  ('b2222222-2222-4222-8222-222222222222', 'candidate-other@example.test');

insert into public.app_users (user_id, is_active)
values
  ('b1111111-1111-4111-8111-111111111111', true),
  ('b2222222-2222-4222-8222-222222222222', true);

insert into public.documents (
  id,
  user_id,
  title,
  kind,
  original_filename,
  storage_path,
  status
) values
  (
    'b3333333-3333-4333-8333-333333333333',
    'b1111111-1111-4111-8111-111111111111',
    'Documento elegível',
    'pdf',
    'candidate.pdf',
    'b1111111-1111-4111-8111-111111111111/candidate.pdf',
    'processing'
  ),
  (
    'b4444444-4444-4444-8444-444444444444',
    'b2222222-2222-4222-8222-222222222222',
    'Documento de outro usuário',
    'pdf',
    'candidate-other.pdf',
    'b2222222-2222-4222-8222-222222222222/candidate-other.pdf',
    'processing'
  );

insert into public.pages (id, user_id, document_id, page_number, status)
values
  (
    'b5555555-5555-4555-8555-555555555551',
    'b1111111-1111-4111-8111-111111111111',
    'b3333333-3333-4333-8333-333333333333',
    1,
    'pending'
  ),
  (
    'b5555555-5555-4555-8555-555555555552',
    'b1111111-1111-4111-8111-111111111111',
    'b3333333-3333-4333-8333-333333333333',
    2,
    'processing'
  ),
  (
    'b5555555-5555-4555-8555-555555555553',
    'b1111111-1111-4111-8111-111111111111',
    'b3333333-3333-4333-8333-333333333333',
    3,
    'pending'
  ),
  (
    'b6666666-6666-4666-8666-666666666666',
    'b2222222-2222-4222-8222-222222222222',
    'b4444444-4444-4444-8444-444444444444',
    7,
    'pending'
  );

insert into public.ocr_jobs (
  id,
  user_id,
  page_id,
  idempotency_key,
  route,
  status,
  attempt_count
) values
  (
    'b7777777-7777-4777-8777-777777777771',
    'b1111111-1111-4111-8111-111111111111',
    'b5555555-5555-4555-8555-555555555551',
    'candidate-owner-pending',
    'gemini',
    'pending',
    1
  ),
  (
    'b7777777-7777-4777-8777-777777777772',
    'b1111111-1111-4111-8111-111111111111',
    'b5555555-5555-4555-8555-555555555552',
    'candidate-owner-processing',
    'gemini',
    'processing',
    1
  ),
  (
    'b7777777-7777-4777-8777-777777777773',
    'b1111111-1111-4111-8111-111111111111',
    'b5555555-5555-4555-8555-555555555553',
    'candidate-owner-desktop',
    'desktop',
    'waiting_desktop',
    0
  ),
  (
    'b8888888-8888-4888-8888-888888888888',
    'b2222222-2222-4222-8222-222222222222',
    'b6666666-6666-4666-8666-666666666666',
    'candidate-other-pending',
    'gemini',
    'pending',
    0
  );

select ok(
  has_function_privilege('authenticated', 'public.list_gemini_ocr_candidates()', 'EXECUTE'),
  'authenticated users may list Gemini jobs eligible for desktop routing'
);

select ok(
  not has_function_privilege('anon', 'public.list_gemini_ocr_candidates()', 'EXECUTE'),
  'anonymous users cannot list Gemini routing candidates'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1111111-1111-4111-8111-111111111111', true);

select is(
  (select count(*)::integer from public.list_gemini_ocr_candidates()),
  1,
  'only caller-owned pending Gemini work with a pending page is eligible'
);

select results_eq(
  $$
    select job_id, document_title, page_number, attempt_count
      from public.list_gemini_ocr_candidates()
  $$,
  $$
    values (
      'b7777777-7777-4777-8777-777777777771'::uuid,
      'Documento elegível'::text,
      1::integer,
      1::integer
    )
  $$,
  'candidate metadata is sufficient to identify pending work without OCR payloads'
);

select is(
  (select document_id from public.list_gemini_ocr_candidates()),
  'b3333333-3333-4333-8333-333333333333'::uuid,
  'candidate is bound to the caller-owned document'
);

select is(
  (select page_id from public.list_gemini_ocr_candidates()),
  'b5555555-5555-4555-8555-555555555551'::uuid,
  'candidate is bound to the caller-owned page'
);

select is(
  (select to_jsonb(candidate) ? 'desktop_lease_id' from public.list_gemini_ocr_candidates() as candidate),
  false,
  'candidate payload does not expose a desktop lease nonce'
);

select set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
select results_eq(
  $$
    select document_title, page_number
      from public.list_gemini_ocr_candidates()
  $$,
  $$ values ('Documento de outro usuário'::text, 7::integer) $$,
  'each caller sees only their own Gemini routing candidates'
);

select * from finish();
rollback;
