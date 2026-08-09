begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'desktop-completion@example.test');
insert into public.app_users (user_id, is_active)
values ('11111111-1111-4111-8111-111111111111', true);

select public.register_ocr_worker_device(
  '11111111-1111-4111-8111-111111111111',
  'Desktop completion worker',
  repeat('11', 32),
  '{"backend":"transformers"}'::jsonb
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
  'desktop-completion-google-subject',
  'desktop-completion@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

select public.stage_drive_pdf_reference(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  null,
  'PDF para conclusão desktop',
  'desktop-completion.pdf',
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

select public.set_ocr_job_route(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'desktop'::public.ocr_route
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_desktop_ocr_job(uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb,boolean,integer)',
    'EXECUTE'
  ),
  'browser role cannot call the desktop completion boundary'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.clear_desktop_ocr_completed_source(uuid,uuid,text)',
    'EXECUTE'
  ),
  'browser role cannot clear a completed desktop source directly'
);

reset role;

select public.claim_desktop_ocr_job(
  '11111111-1111-4111-8111-111111111111',
  (
    select id from public.ocr_worker_devices
     where credential_hash = decode(repeat('11', 32), 'hex')
  ),
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  120
);

select public.bind_desktop_ocr_job_source_hash(
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  (
    select id from public.ocr_worker_devices
     where credential_hash = decode(repeat('11', 32), 'hex')
  ),
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  repeat('ab', 32)
);

select lives_ok(
  $$
    select public.complete_desktop_ocr_job(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      repeat('ab', 32),
      'transformers',
      'microsoft/trocr-base-printed',
      '2026.08.1+cpu',
      'Texto OCR local',
      'Texto OCR local corrigido',
      'printed',
      '[{"code":"low_contrast","message":"Baixo contraste detectado."}]'::jsonb,
      true,
      1432
    )
  $$,
  'active lease with the bound source digest can complete exactly once'
);

select results_eq(
  $$
    select
      provider,
      model,
      raw_text,
      corrected_text,
      content_type,
      warnings,
      metadata ->> 'source',
      metadata ->> 'sourceSha256',
      metadata ->> 'backend',
      metadata ->> 'modelVersion',
      (metadata ->> 'timingMs')::integer,
      (metadata ->> 'needsReview')::boolean
      from public.ocr_results
     where ocr_job_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  $$,
  $$
    values (
      'local'::text,
      'microsoft/trocr-base-printed'::text,
      'Texto OCR local'::text,
      'Texto OCR local corrigido'::text,
      'printed'::text,
      '[{"code":"low_contrast","message":"Baixo contraste detectado."}]'::jsonb,
      'desktop_worker'::text,
      repeat('ab', 32)::text,
      'transformers'::text,
      '2026.08.1+cpu'::text,
      1432::integer,
      true::boolean
    )
  $$,
  'immutable result records local engine provenance and source identity'
);

select results_eq(
  $$
    select
      page.status::text,
      page.ocr_raw_text,
      page.corrected_text,
      page.extraction_source::text,
      page.accepted_ocr_result_id = result.id
      from public.pages as page
      join public.ocr_results as result
        on result.page_id = page.id
       and result.user_id = page.user_id
     where page.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  $$,
  $$
    values (
      'needs_review'::text,
      'Texto OCR local'::text,
      'Texto OCR local corrigido'::text,
      'ocr'::text,
      true::boolean
    )
  $$,
  'page summary points at the accepted local result'
);

select results_eq(
  $$
    select
      provider,
      model,
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
      'local'::text,
      'microsoft/trocr-base-printed'::text,
      'ready'::text,
      null::uuid,
      null::uuid,
      null::text,
      null::timestamptz
    )
  $$,
  'completion clears lease-bound mutable state after immutable provenance is stored'
);

select is(
  (select count(*) from public.ocr_results where ocr_job_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  1::bigint,
  'first completion creates exactly one immutable OCR result'
);

select lives_ok(
  $$
    select public.complete_desktop_ocr_job(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      repeat('ab', 32),
      'transformers',
      'microsoft/trocr-base-printed',
      '2026.08.1+cpu',
      'Texto OCR local',
      'Texto OCR local corrigido',
      'printed',
      '[{"code":"low_contrast","message":"Baixo contraste detectado."}]'::jsonb,
      true,
      1432
    )
  $$,
  'exact completion retry succeeds after the lease has already been cleared'
);

select is(
  (select count(*) from public.ocr_results where ocr_job_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  1::bigint,
  'exact retry does not duplicate immutable result history'
);

select throws_ok(
  $$
    select public.complete_desktop_ocr_job(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      repeat('ab', 32),
      'transformers',
      'microsoft/trocr-base-printed',
      '2026.08.1+cpu',
      'Texto conflitante',
      'Texto OCR local corrigido',
      'printed',
      '[{"code":"low_contrast","message":"Baixo contraste detectado."}]'::jsonb,
      true,
      1432
    )
  $$,
  '22023',
  'Desktop OCR completion conflicts with the persisted result',
  'conflicting replay cannot overwrite immutable OCR output'
);

select ok(
  (select temporary_image_path is not null from public.pages where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'successful database completion keeps the derivative reference until storage deletion succeeds'
);

select ok(
  public.clear_desktop_ocr_completed_source(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    (select id from public.ocr_results where ocr_job_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/pages/1.webp'
  ),
  'service cleanup clears the source pointer only for the accepted local result'
);

select ok(
  (select temporary_image_path is null from public.pages where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'source pointer is null after confirmed cleanup'
);

select lives_ok(
  $$
    select public.complete_desktop_ocr_job(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      repeat('ab', 32),
      'transformers',
      'microsoft/trocr-base-printed',
      '2026.08.1+cpu',
      'Texto OCR local',
      'Texto OCR local corrigido',
      'printed',
      '[{"code":"low_contrast","message":"Baixo contraste detectado."}]'::jsonb,
      true,
      1432
    )
  $$,
  'exact replay remains safe after derivative cleanup'
);

select is(
  public.clear_desktop_ocr_completed_source(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    (select id from public.ocr_results where ocr_job_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/pages/1.webp'
  ),
  false,
  'cleanup is a no-op after the pointer was already cleared'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.revoke_ocr_worker_device(
  (
    select device_id
      from public.list_ocr_worker_devices()
     where label = 'Desktop completion worker'
  )
);
reset role;

select throws_ok(
  $$
    select public.complete_desktop_ocr_job(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      (
        select id from public.ocr_worker_devices
         where credential_hash = decode(repeat('11', 32), 'hex')
      ),
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      repeat('ab', 32),
      'transformers',
      'microsoft/trocr-base-printed',
      '2026.08.1+cpu',
      'Texto OCR local',
      'Texto OCR local corrigido',
      'printed',
      '[{"code":"low_contrast","message":"Baixo contraste detectado."}]'::jsonb,
      true,
      1432
    )
  $$,
  '55P03',
  'Desktop OCR device is unavailable',
  'revoked devices cannot replay completed submissions'
);

select * from finish();
rollback;
