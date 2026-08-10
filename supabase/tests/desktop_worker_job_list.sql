begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email)
values
  ('a1111111-1111-4111-8111-111111111111', 'queue-owner@example.test'),
  ('a2222222-2222-4222-8222-222222222222', 'queue-other@example.test');

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
) values
  (
    'a3333333-3333-4333-8333-333333333333',
    'a1111111-1111-4111-8111-111111111111',
    'Documento da fila',
    'pdf',
    'fila.pdf',
    'a1111111-1111-4111-8111-111111111111/fila.pdf',
    'processing'
  ),
  (
    'a4444444-4444-4444-8444-444444444444',
    'a2222222-2222-4222-8222-222222222222',
    'Documento privado de outro usuário',
    'pdf',
    'outro.pdf',
    'a2222222-2222-4222-8222-222222222222/outro.pdf',
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
    'a5555555-5555-4555-8555-555555555555',
    'a1111111-1111-4111-8111-111111111111',
    'a3333333-3333-4333-8333-333333333333',
    3,
    'processing'
  ),
  (
    'a6666666-6666-4666-8666-666666666666',
    'a2222222-2222-4222-8222-222222222222',
    'a4444444-4444-4444-8444-444444444444',
    7,
    'processing'
  );

insert into public.ocr_worker_devices (
  id,
  user_id,
  label,
  credential_hash,
  capabilities
) values
  (
    'a7777777-7777-4777-8777-777777777777',
    'a1111111-1111-4111-8111-111111111111',
    'Desktop da fila',
    decode(repeat('a1', 32), 'hex'),
    '{}'::jsonb
  ),
  (
    'a8888888-8888-4888-8888-888888888888',
    'a2222222-2222-4222-8222-222222222222',
    'Desktop de outro usuário',
    decode(repeat('a2', 32), 'hex'),
    '{}'::jsonb
  );

insert into public.ocr_jobs (
  id,
  user_id,
  page_id,
  idempotency_key,
  route,
  status,
  attempt_count,
  last_error_code,
  desktop_lease_device_id,
  desktop_lease_id,
  desktop_lease_started_at,
  desktop_lease_expires_at
) values
  (
    'a9999999-9999-4999-8999-999999999999',
    'a1111111-1111-4111-8111-111111111111',
    'a5555555-5555-4555-8555-555555555555',
    'desktop-queue-owner-job',
    'desktop',
    'processing',
    2,
    'worker_timeout',
    'a7777777-7777-4777-8777-777777777777',
    'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    timezone('utc', now()) - interval '3 minutes',
    timezone('utc', now()) - interval '1 minute'
  ),
  (
    'accccccc-cccc-4ccc-8ccc-cccccccccccc',
    'a2222222-2222-4222-8222-222222222222',
    'a6666666-6666-4666-8666-666666666666',
    'desktop-queue-other-job',
    'desktop',
    'processing',
    1,
    null,
    'a8888888-8888-4888-8888-888888888888',
    'addddddd-dddd-4ddd-8ddd-dddddddddddd',
    timezone('utc', now()) - interval '1 minute',
    timezone('utc', now()) + interval '3 minutes'
  );

select ok(
  has_function_privilege('authenticated', 'public.list_desktop_ocr_jobs()', 'EXECUTE'),
  'authenticated users may call the bounded desktop queue RPC'
);

select ok(
  not has_function_privilege('anon', 'public.list_desktop_ocr_jobs()', 'EXECUTE'),
  'anonymous users cannot call the desktop queue RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);

select is(
  (select count(*)::integer from public.list_desktop_ocr_jobs()),
  1,
  'the queue returns only caller-owned desktop jobs'
);

select results_eq(
  $$
    select
      job_id,
      document_title,
      page_number,
      status,
      attempt_count,
      last_error_code,
      device_label,
      lease_expired
    from public.list_desktop_ocr_jobs()
  $$,
  $$
    values (
      'a9999999-9999-4999-8999-999999999999'::uuid,
      'Documento da fila'::text,
      3::integer,
      'processing'::text,
      2::integer,
      'worker_timeout'::text,
      'Desktop da fila'::text,
      true::boolean
    )
  $$,
  'the queue exposes bounded operational metadata and server-derived lease expiry'
);

select is(
  (select device_id from public.list_desktop_ocr_jobs()),
  'a7777777-7777-4777-8777-777777777777'::uuid,
  'the queue identifies the current device without exposing its credential'
);

select is(
  (select document_id from public.list_desktop_ocr_jobs()),
  'a3333333-3333-4333-8333-333333333333'::uuid,
  'the queue binds the job to its caller-owned document'
);

select is(
  (select page_id from public.list_desktop_ocr_jobs()),
  'a5555555-5555-4555-8555-555555555555'::uuid,
  'the queue binds the job to its caller-owned page'
);

select ok(
  (select lease_expires_at is not null and lease_started_at is not null from public.list_desktop_ocr_jobs()),
  'the queue exposes lease timing without exposing the lease nonce/id'
);

select * from finish();
rollback;
