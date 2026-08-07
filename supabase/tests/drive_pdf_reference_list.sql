begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'resume-owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'resume-other@example.test');
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
  'resume-owner-google-subject',
  'resume-owner@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

select public.stage_drive_pdf_reference(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  null,
  'PDF preservado',
  'pdf-preservado.pdf',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  '0ARootFolderId_123456789',
  '2026-08-07T10:00:00Z',
  '3',
  null,
  73400320,
  '2026-08-05T12:00:00Z'
);

select is(
  public.list_drive_pdf_reference_imports(),
  jsonb_build_array(
    jsonb_build_object(
      'documentId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'driveFileId', '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
      'sourceSizeBytes', 73400320,
      'status', 'pending_inspection',
      'title', 'PDF preservado',
      'sourceModifiedAt', '2026-08-05T12:00:00+00:00',
      'updatedAt', (select updated_at from public.drive_pdf_reference_imports where document_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    )
  ),
  'owner can list the exact safe metadata needed to resume a staged reference'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(
  public.list_drive_pdf_reference_imports(),
  '[]'::jsonb,
  'another authorized user cannot discover the staged Drive reference'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
delete from public.documents where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is(
  public.list_drive_pdf_reference_imports(),
  '[]'::jsonb,
  'deleting the logical document also removes the resumable staging entry'
);

select * from finish();
rollback;
