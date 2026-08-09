begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'desktop-route@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'desktop-other@example.test');
insert into public.app_users (user_id, is_active)
values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true);

insert into public.ocr_worker_devices (
  id,
  user_id,
  label,
  credential_hash,
  capabilities
) values
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'Desktop principal',
    decode(repeat('11', 32), 'hex'),
    '{"cpu":true}'::jsonb
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    'Desktop secundário',
    decode(repeat('22', 32), 'hex'),
    '{"cpu":true}'::jsonb
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    '22222222-2222-4222-8222-222222222222',
    'Outro usuário',
    decode(repeat('33', 32), 'hex'),
    '{"cpu":true}'::jsonb
  );

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
  'desktop-route-google-subject',
  'desktop-route@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

select public.stage_drive_pdf_reference(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  null,
  'PDF com roteamento desktop',
  'desktop-route.pdf',
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
  2
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
    ),
    jsonb_build_object(
      'id', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'pageNumber', 2,
      'nativeText', null,
      'needsOcr', true,
      'temporaryImagePath', '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/pages/2.webp',
      'jobId', 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )
  )
);

select public.finalize_drive_pdf_reference_descriptor_attempt(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  3
);

select results_eq(
  $$
    select page_id, route::text
      from public.ocr_jobs
     where page_id in (
       'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
       'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
     )
     order by page_id
  $$,
  $$
    values
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, 'gemini'::text),
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid, 'gemini'::text)
  $$,
  'new OCR jobs default to the Gemini route'
);

select throws_ok(
  $$ select count(*) from public.ocr_worker_devices $$,
  '42501',
  null,
  'authenticated users cannot read the service-private device table'
);

select results_eq(
  $$
    select device_id, label, status, capabilities, (last_seen_at is null)
      from public.list_ocr_worker_devices()
     order by device_id
  $$,
  $$
    values
      (
        '33333333-3333-4333-8333-333333333333'::uuid,
        'Desktop principal'::text,
        'active'::text,
        '{"cpu":true}'::jsonb,
        true::boolean
      ),
      (
        '44444444-4444-4444-8444-444444444444'::uuid,
        'Desktop secundário'::text,
        'active'::text,
        '{"cpu":true}'::jsonb,
        true::boolean
      )
  $$,
  'safe device listing returns only caller-owned non-secret metadata'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_desktop_ocr_job(uuid,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated users cannot claim desktop jobs directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.renew_desktop_ocr_job_lease(uuid,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated users cannot renew desktop leases directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.expire_desktop_ocr_job_leases()',
    'EXECUTE'
  ),
  'authenticated users cannot expire desktop leases directly'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.set_ocr_job_route(uuid,public.ocr_route)',
    'EXECUTE'
  ),
  'authenticated users may route their own idle OCR jobs'
);

select lives_ok(
  $$
    select public.complete_ocr_job(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Texto Gemini preservado',
      '[]'::jsonb,
      'needs_review'::public.page_status,
      '2026-08-08T12:05:00Z'::timestamptz
    )
  $$,
  'Gemini completion remains valid for the default Gemini route'
);

reset role;
select is(
  (
    select count(*)
      from public.ocr_results
     where page_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  1::bigint,
  'Gemini completion still persists immutable OCR history'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$
    select public.set_ocr_job_route(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'desktop'::public.ocr_route
    )
  $$,
  'an idle owner job can be routed to desktop'
);

select results_eq(
  $$
    select route::text, status::text, desktop_lease_id
      from public.ocr_jobs
     where page_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  $$,
  $$ values ('desktop'::text, 'waiting_desktop'::text, null::uuid) $$,
  'desktop routing moves the job to waiting_desktop without a lease'
);

select throws_ok(
  $$
    select public.complete_ocr_job(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'Não pode entrar pelo Gemini',
      '[]'::jsonb,
      'needs_review'::public.page_status,
      '2026-08-08T12:06:00Z'::timestamptz
    )
  $$,
  '55000',
  'Desktop-routed OCR jobs require the desktop completion boundary',
  'Gemini completion fails closed for a desktop-routed job'
);

reset role;
select is(
  (
    select count(*)
      from public.ocr_results
     where page_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  ),
  0::bigint,
  'rejected Gemini completion creates no desktop result'
);

select lives_ok(
  $$
    select public.claim_desktop_ocr_job(
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666',
      120
    )
  $$,
  'the first active device can claim the waiting desktop job'
);

select results_eq(
  $$
    select
      status::text,
      desktop_lease_device_id,
      desktop_lease_id,
      (desktop_lease_expires_at > timezone('utc', now()))
      from public.ocr_jobs
     where page_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  $$,
  $$
    values (
      'processing'::text,
      '33333333-3333-4333-8333-333333333333'::uuid,
      '66666666-6666-4666-8666-666666666666'::uuid,
      true::boolean
    )
  $$,
  'claim stores the exact device and lease tuple with a future expiry'
);

select is(
  public.claim_desktop_ocr_job(
    '11111111-1111-4111-8111-111111111111',
    '44444444-4444-4444-8444-444444444444',
    '77777777-7777-4777-8777-777777777777',
    120
  ),
  null::jsonb,
  'a second device cannot claim the already leased job'
);

select throws_ok(
  $$
    select public.renew_desktop_ocr_job_lease(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      '33333333-3333-4333-8333-333333333333',
      '77777777-7777-4777-8777-777777777777',
      120
    )
  $$,
  '55P03',
  'Desktop OCR lease is not active',
  'a mismatched lease id cannot renew the job'
);

select lives_ok(
  $$
    select public.renew_desktop_ocr_job_lease(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666',
      120
    )
  $$,
  'the exact unexpired lease tuple can renew'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$
    select public.set_ocr_job_route(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'gemini'::public.ocr_route
    )
  $$,
  '55P03',
  'OCR job has an active desktop lease',
  'browser routing cannot steal a live desktop lease'
);

reset role;
update public.ocr_jobs
   set desktop_lease_started_at = timezone('utc', now()) - interval '2 minutes',
       desktop_lease_expires_at = timezone('utc', now()) - interval '1 minute'
 where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

select is(
  public.expire_desktop_ocr_job_leases(),
  1,
  'expired desktop leases are reclaimed'
);

select results_eq(
  $$
    select status::text, desktop_lease_device_id, desktop_lease_id
      from public.ocr_jobs
     where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  $$,
  $$ values ('waiting_desktop'::text, null::uuid, null::uuid) $$,
  'expiry returns the job to waiting_desktop and clears ownership'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$
    select public.set_ocr_job_route(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'gemini'::public.ocr_route
    )
  $$,
  'an unleased waiting job can return to Gemini'
);

select lives_ok(
  $$
    select public.set_ocr_job_route(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'desktop'::public.ocr_route
    )
  $$,
  'the owner can route the idle job back to desktop'
);

reset role;
select lives_ok(
  $$
    select public.claim_desktop_ocr_job(
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444',
      '77777777-7777-4777-8777-777777777777',
      120
    )
  $$,
  'a different active device can reclaim the job after expiry and reroute'
);

select throws_ok(
  $$
    select public.renew_desktop_ocr_job_lease(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666',
      120
    )
  $$,
  '55P03',
  'Desktop OCR lease is not active',
  'the stale pre-expiry lease cannot renew after another device reclaims the job'
);

select results_eq(
  $$
    select desktop_lease_device_id, desktop_lease_id
      from public.ocr_jobs
     where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  $$,
  $$
    values (
      '44444444-4444-4444-8444-444444444444'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid
    )
  $$,
  'the reclaimed job records only the new exact lease tuple'
);

select * from finish();
rollback;
