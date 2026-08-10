begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email)
values ('91111111-1111-4111-8111-111111111111', 'claim-reaper@example.test');

insert into public.app_users (user_id, is_active)
values ('91111111-1111-4111-8111-111111111111', true);

insert into public.documents (
  id,
  user_id,
  title,
  kind,
  original_filename,
  storage_path,
  status
) values (
  '92222222-2222-4222-8222-222222222222',
  '91111111-1111-4111-8111-111111111111',
  'Documento do reaper',
  'pdf',
  'reaper.pdf',
  '91111111-1111-4111-8111-111111111111/reaper.pdf',
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
    '93333333-3333-4333-8333-333333333333',
    '91111111-1111-4111-8111-111111111111',
    '92222222-2222-4222-8222-222222222222',
    1,
    'processing'
  ),
  (
    '94444444-4444-4444-8444-444444444444',
    '91111111-1111-4111-8111-111111111111',
    '92222222-2222-4222-8222-222222222222',
    2,
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
    '95555555-5555-4555-8555-555555555555',
    '91111111-1111-4111-8111-111111111111',
    'Worker antigo',
    decode(repeat('91', 32), 'hex'),
    '{}'::jsonb
  ),
  (
    '96666666-6666-4666-8666-666666666666',
    '91111111-1111-4111-8111-111111111111',
    'Worker novo',
    decode(repeat('92', 32), 'hex'),
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
    '97777777-7777-4777-8777-777777777777',
    '91111111-1111-4111-8111-111111111111',
    '93333333-3333-4333-8333-333333333333',
    'claim-reaper-expired-job',
    'desktop',
    'processing',
    '95555555-5555-4555-8555-555555555555',
    '98888888-8888-4888-8888-888888888888',
    timezone('utc', now()) - interval '3 minutes',
    timezone('utc', now()) - interval '2 minutes'
  ),
  (
    '99999999-9999-4999-8999-999999999999',
    '91111111-1111-4111-8111-111111111111',
    '94444444-4444-4444-8444-444444444444',
    'claim-reaper-live-job',
    'desktop',
    'processing',
    '95555555-5555-4555-8555-555555555555',
    '90000000-0000-4000-8000-000000000001',
    timezone('utc', now()) - interval '1 minute',
    timezone('utc', now()) + interval '5 minutes'
  );

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_desktop_ocr_job(uuid,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'browser users still cannot invoke the service-only claim boundary'
);

select lives_ok(
  $$
    select public.claim_desktop_ocr_job(
      '91111111-1111-4111-8111-111111111111',
      '96666666-6666-4666-8666-666666666666',
      '90000000-0000-4000-8000-000000000002',
      120
    )
  $$,
  'a new worker claim reaps and immediately reclaims an expired lease'
);

select results_eq(
  $$
    select status::text, desktop_lease_device_id, desktop_lease_id,
           (desktop_lease_expires_at > timezone('utc', now()))
      from public.ocr_jobs
     where id = '97777777-7777-4777-8777-777777777777'
  $$,
  $$
    values (
      'processing'::text,
      '96666666-6666-4666-8666-666666666666'::uuid,
      '90000000-0000-4000-8000-000000000002'::uuid,
      true::boolean
    )
  $$,
  'the expired job is owned by the new live lease after claim'
);

select results_eq(
  $$
    select desktop_lease_device_id, desktop_lease_id,
           (desktop_lease_expires_at > timezone('utc', now()))
      from public.ocr_jobs
     where id = '99999999-9999-4999-8999-999999999999'
  $$,
  $$
    values (
      '95555555-5555-4555-8555-555555555555'::uuid,
      '90000000-0000-4000-8000-000000000001'::uuid,
      true::boolean
    )
  $$,
  'a still-live lease is never stolen by the reaper'
);

select is(
  public.claim_desktop_ocr_job(
    '91111111-1111-4111-8111-111111111111',
    '96666666-6666-4666-8666-666666666666',
    '90000000-0000-4000-8000-000000000003',
    120
  ),
  null::jsonb,
  'a second claim sees no waiting work while both leases are live'
);

select is(
  (
    select count(*)::integer
      from public.ocr_jobs
     where user_id = '91111111-1111-4111-8111-111111111111'
       and status = 'waiting_desktop'
  ),
  0,
  'no stale waiting row remains after atomic reap and reclaim'
);

select is(
  (
    select count(*)::integer
      from public.ocr_jobs
     where user_id = '91111111-1111-4111-8111-111111111111'
       and desktop_lease_id is not null
  ),
  2,
  'both jobs finish the test with exactly one live lease each'
);

select * from finish();
rollback;
