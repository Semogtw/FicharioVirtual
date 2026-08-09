begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'worker-auth@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'worker-other@example.test');
insert into public.app_users (user_id, is_active)
values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true);

select lives_ok(
  $$
    select public.register_ocr_worker_device(
      '11111111-1111-4111-8111-111111111111',
      'Worker autenticado',
      repeat('11', 32),
      '{"cpu":true,"backend":"test"}'::jsonb
    )
  $$,
  'service boundary can register a device from a SHA-256 digest'
);

select ok(
  (public.authenticate_ocr_worker_device(repeat('11', 32)) ->> 'userId') =
    '11111111-1111-4111-8111-111111111111',
  'the stored digest authenticates the active device owner'
);

select is(
  public.authenticate_ocr_worker_device(repeat('22', 32)),
  null::jsonb,
  'an unknown digest authenticates no device'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.authenticate_ocr_worker_device(text)',
    'EXECUTE'
  ),
  'browser role cannot call the service-only digest authenticator'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.bind_desktop_ocr_job_source_hash(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'browser role cannot bind a desktop source digest'
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
  'worker-auth-google-subject',
  'worker-auth@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

select public.stage_drive_pdf_reference(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  null,
  'PDF para worker autenticado',
  'worker-auth.pdf',
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

select lives_ok(
  $$
    select public.set_ocr_job_route(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'desktop'::public.ocr_route
    )
  $$,
  'owner can route the fresh OCR job to desktop'
);

reset role;

select lives_ok(
  $$
    select public.claim_desktop_ocr_job(
      '11111111-1111-4111-8111-111111111111',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      120
    )
  $$,
  'authenticated device identity can be used by the service claim boundary'
);

select results_eq(
  $$
    select
      source ->> 'pageId',
      source ->> 'storagePath'
    from (
      select public.get_desktop_ocr_job_source(
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        (
          select id from public.ocr_worker_devices
           where credential_hash = decode(repeat('11', 32), 'hex')
        ),
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      ) as source
    ) as resolved
  $$,
  $$
    values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::text,
      '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/pages/1.webp'::text
    )
  $$,
  'exact active lease resolves only its expected private derivative path'
);

select lives_ok(
  $$
    select public.bind_desktop_ocr_job_source_hash(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      repeat('ab', 32)
    )
  $$,
  'service boundary can bind the downloaded derivative digest to the active lease'
);

select results_eq(
  $$
    select desktop_source_sha256, desktop_source_bound_at is not null
      from public.ocr_jobs
     where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  $$,
  $$ values (repeat('ab', 32)::text, true) $$,
  'the active lease persists exactly one source digest and binding timestamp'
);

select lives_ok(
  $$
    select public.bind_desktop_ocr_job_source_hash(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      repeat('ab', 32)
    )
  $$,
  'repeating the same source digest is idempotent for the active lease'
);

select throws_ok(
  $$
    select public.bind_desktop_ocr_job_source_hash(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      repeat('cd', 32)
    )
  $$,
  '22023',
  'Desktop OCR source binding conflicts with the active lease',
  'the same lease cannot be rebound to different source bytes'
);

select throws_ok(
  $$
    select public.get_desktop_ocr_job_source(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )
  $$,
  '55P03',
  'Desktop OCR source lease is not active',
  'wrong lease id cannot resolve source metadata'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$
    select public.revoke_ocr_worker_device(
      (
        select device_id
          from public.list_ocr_worker_devices()
         limit 1
      )
    )
  $$,
  '22023',
  'Invalid OCR worker device id',
  'another user cannot discover and revoke the first user device'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok(
  $$
    select public.revoke_ocr_worker_device(
      (
        select device_id
          from public.list_ocr_worker_devices()
         where label = 'Worker autenticado'
         limit 1
      )
    )
  $$,
  'device owner can revoke the paired worker'
);

reset role;
select results_eq(
  $$
    select
      status::text,
      desktop_lease_device_id,
      desktop_lease_id,
      desktop_source_sha256,
      desktop_source_bound_at
      from public.ocr_jobs
     where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  $$,
  $$
    values (
      'waiting_desktop'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::timestamptz
    )
  $$,
  'revocation atomically requeues the active job and clears its lease-bound source digest'
);

select is(
  public.authenticate_ocr_worker_device(repeat('11', 32)),
  null::jsonb,
  'revoked device digest no longer authenticates'
);

select throws_ok(
  $$
    select public.renew_desktop_ocr_job_lease(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      120
    )
  $$,
  '55P03',
  'Desktop OCR lease is not active',
  'revoked stale lease cannot renew'
);

select throws_ok(
  $$
    select public.get_desktop_ocr_job_source(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    )
  $$,
  '55P03',
  'Desktop OCR source lease is not active',
  'revoked stale lease cannot resolve source metadata'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select results_eq(
  $$
    select
      result ->> 'status',
      (result ->> 'requeuedJobs')::integer
    from (
      select public.revoke_ocr_worker_device(
        (
          select device_id
            from public.list_ocr_worker_devices()
           where label = 'Worker autenticado'
           limit 1
        )
      ) as result
    ) as revoked
  $$,
  $$ values ('revoked'::text, 0::integer) $$,
  'revocation is idempotent after the first lease cleanup'
);

select * from finish();
rollback;
