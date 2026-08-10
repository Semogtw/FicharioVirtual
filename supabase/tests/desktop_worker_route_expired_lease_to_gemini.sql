begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email)
values
  ('a1111111-1111-4111-8111-111111111111', 'route-rescue@example.test'),
  ('a2222222-2222-4222-8222-222222222222', 'route-rescue-other@example.test');

insert into public.app_users (user_id, is_active)
values
  ('a1111111-1111-4111-8111-111111111111', true),
  ('a2222222-2222-4222-8222-222222222222', true);

insert into public.documents (
  id,
  user_id,
  title,
  kind,
  original_filename,
  storage_path,
  status
) values (
  'a3333333-3333-4333-8333-333333333333',
  'a1111111-1111-4111-8111-111111111111',
  'Documento para resgate de rota',
  'pdf',
  'route-rescue.pdf',
  'a1111111-1111-4111-8111-111111111111/route-rescue.pdf',
  'processing'
);

insert into public.pages (
  id,
  user_id,
  document_id,
  page_number,
  status
) values
  (
    'a4444444-4444-4444-8444-444444444444',
    'a1111111-1111-4111-8111-111111111111',
    'a3333333-3333-4333-8333-333333333333',
    1,
    'processing'
  ),
  (
    'a5555555-5555-4555-8555-555555555555',
    'a1111111-1111-4111-8111-111111111111',
    'a3333333-3333-4333-8333-333333333333',
    2,
    'processing'
  ),
  (
    'a6666666-6666-4666-8666-666666666666',
    'a1111111-1111-4111-8111-111111111111',
    'a3333333-3333-4333-8333-333333333333',
    3,
    'processing'
  );

insert into public.ocr_worker_devices (
  id,
  user_id,
  label,
  credential_hash,
  capabilities
) values (
  'a7777777-7777-4777-8777-777777777777',
  'a1111111-1111-4111-8111-111111111111',
  'Worker de resgate',
  decode(repeat('a1', 32), 'hex'),
  '{}'::jsonb
);

insert into public.ocr_jobs (
  id,
  user_id,
  page_id,
  idempotency_key,
  route,
  status,
  desktop_lease_device_id,
  desktop_lease_id,
  desktop_lease_started_at,
  desktop_lease_expires_at
) values
  (
    'a8888888-8888-4888-8888-888888888888',
    'a1111111-1111-4111-8111-111111111111',
    'a4444444-4444-4444-8444-444444444444',
    'route-rescue-expired-job',
    'desktop',
    'processing',
    'a7777777-7777-4777-8777-777777777777',
    'a9999999-9999-4999-8999-999999999999',
    timezone('utc', now()) - interval '3 minutes',
    timezone('utc', now()) - interval '2 minutes'
  ),
  (
    'aa111111-1111-4111-8111-111111111111',
    'a1111111-1111-4111-8111-111111111111',
    'a5555555-5555-4555-8555-555555555555',
    'route-rescue-live-job',
    'desktop',
    'processing',
    'a7777777-7777-4777-8777-777777777777',
    'aa222222-2222-4222-8222-222222222222',
    timezone('utc', now()) - interval '1 minute',
    timezone('utc', now()) + interval '5 minutes'
  ),
  (
    'aa333333-3333-4333-8333-333333333333',
    'a1111111-1111-4111-8111-111111111111',
    'a6666666-6666-4666-8666-666666666666',
    'route-rescue-waiting-job',
    'desktop',
    'waiting_desktop',
    null,
    null,
    null,
    null
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);

select throws_ok(
  $$
    select public.set_ocr_job_route(
      'a5555555-5555-4555-8555-555555555555',
      'gemini'::public.ocr_route
    )
  $$,
  '55P03',
  'OCR job has an active desktop lease',
  'a live desktop lease still cannot be stolen by the browser'
);

select is(
  (public.set_ocr_job_route(
    'a4444444-4444-4444-8444-444444444444',
    'gemini'::public.ocr_route
  ) ->> 'recoveredExpiredLease')::boolean,
  true,
  'the owner can explicitly rescue an expired desktop lease to Gemini'
);

select results_eq(
  $$
    select route::text, status::text, desktop_lease_device_id, desktop_lease_id,
           desktop_lease_started_at, desktop_lease_expires_at
      from public.ocr_jobs
     where id = 'a8888888-8888-4888-8888-888888888888'
  $$,
  $$
    values (
      'gemini'::text,
      'pending'::text,
      null::uuid,
      null::uuid,
      null::timestamptz,
      null::timestamptz
    )
  $$,
  'rescue clears every stale desktop lease binding atomically'
);

select lives_ok(
  $$
    select public.set_ocr_job_route(
      'a6666666-6666-4666-8666-666666666666',
      'gemini'::public.ocr_route
    )
  $$,
  'an unleased waiting desktop job can still return to Gemini'
);

select results_eq(
  $$
    select route::text, status::text
      from public.ocr_jobs
     where id = 'aa333333-3333-4333-8333-333333333333'
  $$,
  $$ values ('gemini'::text, 'pending'::text) $$,
  'ordinary waiting route changes keep their previous semantics'
);

select set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$
    select public.set_ocr_job_route(
      'a5555555-5555-4555-8555-555555555555',
      'gemini'::public.ocr_route
    )
  $$,
  '55000',
  'OCR job is unavailable for route change',
  'another authenticated user cannot route a job they do not own'
);

reset role;
select results_eq(
  $$
    select route::text, status::text, desktop_lease_id
      from public.ocr_jobs
     where id = 'aa111111-1111-4111-8111-111111111111'
  $$,
  $$
    values (
      'desktop'::text,
      'processing'::text,
      'aa222222-2222-4222-8222-222222222222'::uuid
    )
  $$,
  'failed rescue attempts leave the still-live lease untouched'
);

select * from finish();
rollback;
