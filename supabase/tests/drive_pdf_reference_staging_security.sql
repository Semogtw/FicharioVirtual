begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'staging-security@example.test');
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
  'staging-security-google-subject',
  'staging-security@example.test',
  '0ARootFolderId_123456789',
  'initial-page-token'
);

select throws_ok(
  $$
    select public.stage_drive_pdf_reference(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      null,
      'Versão ausente',
      'versao-ausente.pdf',
      '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
      '0ARootFolderId_123456789',
      '2026-08-07T18:30:00Z',
      null,
      'd41d8cd98f00b204e9800998ecf8427e',
      73400320,
      '2026-08-05T12:00:00Z'
    )
  $$,
  '22023',
  null,
  'staging rejects a missing Drive version with a stable validation error'
);

select throws_ok(
  $$
    select public.stage_drive_pdf_reference(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      null,
      'ID inválido',
      'id-invalido.pdf',
      'bad id',
      '0ARootFolderId_123456789',
      '2026-08-07T18:30:00Z',
      '4',
      'd41d8cd98f00b204e9800998ecf8427e',
      73400320,
      '2026-08-05T12:00:00Z'
    )
  $$,
  '22023',
  null,
  'staging rejects a malformed controlled Drive file id'
);

select throws_ok(
  $$
    select public.stage_drive_pdf_reference(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      null,
      'MD5 inválido',
      'md5-invalido.pdf',
      '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
      '0ARootFolderId_123456789',
      '2026-08-07T18:30:00Z',
      '4',
      'not-an-md5',
      73400320,
      '2026-08-05T12:00:00Z'
    )
  $$,
  '22023',
  null,
  'staging rejects malformed Drive checksums'
);

select throws_ok(
  $$
    select public.stage_drive_pdf_reference(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      null,
      'Tamanho inválido',
      'tamanho-invalido.pdf',
      '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
      '0ARootFolderId_123456789',
      '2026-08-07T18:30:00Z',
      '4',
      null,
      0,
      '2026-08-05T12:00:00Z'
    )
  $$,
  '22023',
  null,
  'staging rejects a non-positive source size'
);

select is(
  (
    select count(*)
    from public.documents
    where id in (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    )
  ),
  0::bigint,
  'invalid staging attempts roll back their placeholder documents'
);

select is(
  (select count(*) from public.drive_pdf_reference_imports),
  0::bigint,
  'invalid staging attempts never leave resumable metadata behind'
);

select * from finish();
rollback;
