begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'descriptor-lease@example.test');
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
  'descriptor-lease-google-subject',
  'descriptor-lease@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

select public.stage_drive_pdf_reference(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  null,
  'PDF com lease',
  'pdf-com-lease.pdf',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  '0ARootFolderId_123456789',
  '2026-08-08T12:00:00Z',
  '7',
  'd41d8cd98f00b204e9800998ecf8427e',
  125829120,
  '2026-08-08T12:00:00Z'
);

select lives_ok(
  $$
    select public.begin_drive_pdf_reference_descriptor_attempt(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      2
    )
  $$,
  'first descriptor attempt acquires the lease'
);

select results_eq(
  $$
    select descriptor_attempt_id, descriptor_expected_page_count,
           descriptor_attempt_expires_at > timezone('utc', now())
      from public.drive_pdf_reference_imports
     where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      2::integer,
      true::boolean
    )
  $$,
  'lease metadata records ownership, expected pages, and a future expiry'
);

select throws_ok(
  $$
    select public.begin_drive_pdf_reference_descriptor_attempt(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '22222222-2222-4222-8222-222222222222',
      2
    )
  $$,
  '55P03',
  null,
  'a live descriptor lease rejects a competing attempt'
);

select lives_ok(
  $$
    select public.stage_drive_pdf_reference_descriptor_batch(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'pageNumber', 1,
          'nativeText', 'Texto estável',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', null
        )
      )
    )
  $$,
  'the lease owner may stage a descriptor batch'
);

select lives_ok(
  $$
    select public.stage_drive_pdf_reference_descriptor_batch(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'pageNumber', 1,
          'nativeText', 'Texto estável',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', null
        )
      )
    )
  $$,
  'an exact descriptor retry is idempotent'
);

select is(
  (
    select count(*)
      from public.drive_pdf_reference_page_staging
     where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  1::bigint,
  'idempotent retries do not duplicate staged pages'
);

select throws_ok(
  $$
    select public.stage_drive_pdf_reference_descriptor_batch(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      jsonb_build_array(
        jsonb_build_object(
          'id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'pageNumber', 1,
          'nativeText', 'Texto diferente',
          'needsOcr', false,
          'temporaryImagePath', null,
          'jobId', null
        )
      )
    )
  $$,
  '22023',
  null,
  'a retry cannot mutate an already staged page for the same attempt'
);

select lives_ok(
  $$
    select public.renew_drive_pdf_reference_descriptor_attempt(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )
  $$,
  'the active attempt may renew its lease'
);

reset role;
update public.drive_pdf_reference_imports
   set descriptor_attempt_expires_at = timezone('utc', now()) - interval '1 minute'
 where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;

select lives_ok(
  $$
    select public.begin_drive_pdf_reference_descriptor_attempt(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '22222222-2222-4222-8222-222222222222',
      2
    )
  $$,
  'a new attempt may take over an expired lease'
);

select results_eq(
  $$
    select
      descriptor_attempt_id,
      (select count(*) from public.drive_pdf_reference_page_staging
        where document_id = reference.document_id)
      from public.drive_pdf_reference_imports as reference
     where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$ values ('22222222-2222-4222-8222-222222222222'::uuid, 0::bigint) $$,
  'takeover atomically clears descriptors owned by the expired attempt'
);

select is(
  public.abandon_drive_pdf_reference_descriptor_attempt(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  false,
  'a stale attempt cannot abandon the newer owner lease'
);

select is(
  public.abandon_drive_pdf_reference_descriptor_attempt(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222'
  ),
  true,
  'the active owner can abandon its own lease'
);

select results_eq(
  $$
    select descriptor_attempt_id, descriptor_expected_page_count, descriptor_attempt_expires_at
      from public.drive_pdf_reference_imports
     where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$ values (null::uuid, null::integer, null::timestamptz) $$,
  'successful abandonment clears all lease metadata'
);

select * from finish();
rollback;
