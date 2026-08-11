begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'finalizer-security@example.test');
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
  'finalizer-security-google-subject',
  'finalizer-security@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

select public.stage_drive_pdf_reference(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  null,
  'PDF para validar descritores',
  'pdf-validacao.pdf',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  '0ARootFolderId_123456789',
  '2026-08-07T18:30:00Z',
  '4',
  'd41d8cd98f00b204e9800998ecf8427e',
  73400320,
  '2026-08-05T12:00:00Z'
);

-- The launch contract exposes only the renewable lease finalizer. Run payload-hardening
-- assertions against the owner-only private publication implementation; authenticated
-- callers cannot invoke this helper directly.
reset role;

select throws_ok(
  $$
    select private.finalize_drive_pdf_reference_import(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'pageNumber', 1,
          'nativeText', 'Texto nativo',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', null,
          'accessToken', 'must-not-pass'
        )
      ),
      1
    )
  $$,
  '22023',
  null,
  'descriptor with an unexpected field is rejected before publication'
);

select throws_ok(
  $$
    select private.finalize_drive_pdf_reference_import(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      jsonb_build_array(
        jsonb_build_object(
          'id', '------------------------------------',
          'pageNumber', 1,
          'nativeText', 'Texto nativo',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', null
        )
      ),
      1
    )
  $$,
  '22023',
  null,
  'malformed 36-character UUID is rejected with the stable validation error'
);

select throws_ok(
  $$
    select private.finalize_drive_pdf_reference_import(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'pageNumber', 1,
          'nativeText', 'Texto nativo',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', null
        ),
        jsonb_build_object(
          'id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'pageNumber', 2,
          'nativeText', null,
          'needsOcr', true,
          'temporaryImagePath', '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/pages/1.webp',
          'jobId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
        )
      ),
      1
    )
  $$,
  '22023',
  null,
  'OCR descriptor cannot point at another page derivative'
);

select throws_ok(
  $$
    select private.finalize_drive_pdf_reference_import(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'pageNumber', 1,
          'nativeText', 'Texto nativo',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', 123
        )
      ),
      1
    )
  $$,
  '22023',
  null,
  'native descriptor requires an explicit JSON null jobId'
);

select is(
  (select count(*) from public.pages where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0::bigint,
  'invalid descriptors never publish partial pages or OCR jobs'
);

select is(
  (select count(*) from public.drive_pdf_reference_imports where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1::bigint,
  'staging stays durable after every validation failure'
);

select * from finish();
rollback;
