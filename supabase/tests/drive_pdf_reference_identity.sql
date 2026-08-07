begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'identity-owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'identity-other@example.test');
insert into public.app_users (user_id, is_active)
values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true);

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
  'identity-owner-google-subject',
  'identity-owner@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

select public.stage_drive_pdf_reference(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  null,
  'PDF estável',
  'pdf-estavel.pdf',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  '0ARootFolderId_123456789',
  '2026-08-07T18:30:00Z',
  '4',
  'd41d8cd98f00b204e9800998ecf8427e',
  73400320,
  '2026-08-05T12:00:00Z'
);

select is(
  public.get_drive_pdf_reference_identity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'driveFileId',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  'identity lookup returns the staged controlled Drive file'
);

select is(
  public.get_drive_pdf_reference_identity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'driveVersion',
  '4',
  'identity lookup preserves the exact staged Drive version'
);

select is(
  (public.get_drive_pdf_reference_identity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')->>'sourceSizeBytes')::bigint,
  73400320::bigint,
  'identity lookup carries the expected source size used by range validation'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$ select public.get_drive_pdf_reference_identity('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  '55000',
  null,
  'another authorized user cannot resolve the staged physical identity'
);

select * from finish();
rollback;
