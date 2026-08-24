begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select has_function(
  'public',
  'claim_public_azure_ocr_job',
  array['uuid', 'text', 'timestamp with time zone'],
  'the public Azure claim RPC exists with a dedicated signature'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.claim_public_azure_ocr_job(uuid,text,timestamp with time zone)',
    'execute'
  ),
  'authenticated sessions may call the public claim RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.claim_public_azure_ocr_job(uuid,text,timestamp with time zone)',
    'execute'
  ),
  'anonymous sessions cannot call the public claim RPC'
);

insert into auth.users (id, email)
values
  ('a1111111-1111-4111-8111-111111111111', 'public-azure@example.test'),
  ('a2222222-2222-4222-8222-222222222222', 'owner-azure@example.test');

insert into public.app_users (user_id, is_active, provider_profile)
values
  ('a1111111-1111-4111-8111-111111111111', true, 'public'),
  ('a2222222-2222-4222-8222-222222222222', true, 'owner');

insert into public.documents (
  id, user_id, title, kind, original_filename, storage_path, page_count, status
) values
  (
    'a3333333-3333-4333-8333-333333333333',
    'a1111111-1111-4111-8111-111111111111',
    'Public image',
    'image',
    'public.png',
    'a1111111-1111-4111-8111-111111111111/public.png',
    1,
    'processing'
  ),
  (
    'a4444444-4444-4444-8444-444444444444',
    'a1111111-1111-4111-8111-111111111111',
    'Public desktop route',
    'image',
    'desktop.png',
    'a1111111-1111-4111-8111-111111111111/desktop.png',
    1,
    'processing'
  );

insert into public.pages (id, user_id, document_id, page_number, status)
values
  (
    'a5555555-5555-4555-8555-555555555551',
    'a1111111-1111-4111-8111-111111111111',
    'a3333333-3333-4333-8333-333333333333',
    1,
    'pending'
  ),
  (
    'a5555555-5555-4555-8555-555555555552',
    'a1111111-1111-4111-8111-111111111111',
    'a4444444-4444-4444-8444-444444444444',
    1,
    'pending'
  );

insert into public.ocr_jobs (id, user_id, page_id, route, status, idempotency_key)
values
  (
    'a7777777-7777-4777-8777-777777777771',
    'a1111111-1111-4111-8111-111111111111',
    'a5555555-5555-4555-8555-555555555551',
    'gemini',
    'pending',
    'public-azure-pending'
  ),
  (
    'a7777777-7777-4777-8777-777777777772',
    'a1111111-1111-4111-8111-111111111111',
    'a5555555-5555-4555-8555-555555555552',
    'desktop',
    'waiting_desktop',
    'public-azure-desktop'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);

select is(
  public.claim_public_azure_ocr_job(
    'a5555555-5555-4555-8555-555555555551'::uuid,
    'read-v3.2',
    '2026-08-24T12:00:00Z'::timestamptz
  )->>'state',
  'claimed',
  'a public user can claim a pending cloud job for Azure Read v3.2'
);
select results_eq(
  $$
    select provider, model, status::text
      from public.ocr_jobs
     where id = 'a7777777-7777-4777-8777-777777777771'::uuid
  $$,
  $$ values ('azure_vision'::text, 'read-v3.2'::text, 'processing'::text) $$,
  'a public claim switches only its own job to the Azure provider'
);
select is(
  public.claim_public_azure_ocr_job(
    'a5555555-5555-4555-8555-555555555551'::uuid,
    'gemini-2.5-flash',
    '2026-08-24T12:00:01Z'::timestamptz
  )->>'state',
  'invalid_configuration',
  'a public claim rejects a Gemini model before touching the job'
);
select is(
  public.claim_public_azure_ocr_job(
    'a5555555-5555-4555-8555-555555555551'::uuid,
    'read-v3.2',
    '2026-08-24T12:00:02Z'::timestamptz
  )->>'state',
  'busy',
  'a claimed public job cannot be claimed a second time'
);
select is(
  public.claim_public_azure_ocr_job(
    'a5555555-5555-4555-8555-555555555552'::uuid,
    'read-v3.2',
    '2026-08-24T12:00:03Z'::timestamptz
  )->>'state',
  'not_retryable',
  'a public account cannot claim a desktop-routed job'
);
select is(
  (select provider from public.ocr_jobs where id = 'a7777777-7777-4777-8777-777777777772'::uuid),
  'gemini'::text,
  'a rejected desktop claim does not rewrite its provider'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222222', true);
select is(
  public.claim_public_azure_ocr_job(
    'a5555555-5555-4555-8555-555555555551'::uuid,
    'read-v3.2',
    '2026-08-24T12:00:04Z'::timestamptz
  )->>'state',
  'not_authorized',
  'an owner account cannot enter the public Azure claim boundary'
);

select * from finish();
rollback;
