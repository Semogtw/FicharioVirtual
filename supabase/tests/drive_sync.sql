begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'drive-owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'drive-other@example.test');

insert into public.app_users (user_id, is_active)
values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$
    insert into public.drive_connections (
      user_id, status, google_subject, google_email, root_folder_id, start_page_token
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'connected',
      'google-subject-owner',
      'owner@example.test',
      '0AExampleRootFolderId_123456789',
      'initial-page-token'
    )
  $$,
  'authorized owner can create the Drive connection state'
);

select is(
  (select root_folder_id from public.drive_connections),
  '0AExampleRootFolderId_123456789',
  'owner reads the connected root folder identity'
);

select lives_ok(
  $$
    insert into public.notebooks (
      id, user_id, name, drive_folder_id, drive_sync_status
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'Biologia',
      '0ABiologyFolderId_123456789',
      'synced'
    );

    insert into public.notebooks (
      id, user_id, parent_notebook_id, name, drive_folder_id, drive_sync_status
    ) values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Genética',
      '0AGeneticsFolderId_123456789',
      'synced'
    )
  $$,
  'nested notebook preserves a same-owner Drive folder hierarchy'
);

select throws_ok(
  $$
    insert into public.notebooks (user_id, name, drive_folder_id)
    values (
      '11111111-1111-4111-8111-111111111111',
      'Duplicado',
      '0ABiologyFolderId_123456789'
    )
  $$,
  '23505',
  null,
  'Drive folder identity is unique per owner'
);

insert into public.documents (
  id,
  user_id,
  notebook_id,
  title,
  kind,
  original_filename,
  storage_path,
  drive_file_id,
  drive_parent_folder_id,
  drive_mime_type,
  drive_modified_time,
  drive_version,
  physical_state,
  drive_sync_status,
  page_count,
  status
) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '11111111-1111-4111-8111-111111111111',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Fotossíntese',
  'pdf',
  'fotossintese.pdf',
  null,
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  '0AGeneticsFolderId_123456789',
  'application/pdf',
  '2026-08-06T02:00:00Z',
  '7',
  'available',
  'synced',
  1,
  'ready'
);

insert into public.pages (
  id, user_id, document_id, page_number, corrected_text, status
) values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '11111111-1111-4111-8111-111111111111',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  1,
  'Texto corrigido preservado.',
  'ready'
);

select is(
  public.mark_drive_file_missing('1AbCdEfGhIjKlMnOpQrStUvWxYz_123456'),
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  'owner can mark the physical Drive file missing by stable identity'
);

select results_eq(
  $$
    select physical_state::text, title, notebook_id, page_count
    from public.documents
    where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  $$,
  $$
    values (
      'missing'::text,
      'Fotossíntese'::text,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
      1::integer
    )
  $$,
  'missing physical file preserves document metadata'
);

select is(
  (select corrected_text from public.pages where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  'Texto corrigido preservado.',
  'missing physical file preserves searchable page text'
);

select is(
  public.reconnect_drive_file(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
    '2026-08-06T03:00:00Z',
    '8'
  ),
  true,
  'same Drive identity reconnects the missing document'
);

insert into public.drive_sync_jobs (
  id,
  user_id,
  operation,
  status,
  document_id,
  drive_file_id,
  idempotency_key,
  payload
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '11111111-1111-4111-8111-111111111111',
  'upload_file',
  'pending',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
  'upload:cccccccc-cccc-4ccc-8ccc-cccccccccccc:v1',
  '{"source":"local"}'::jsonb
);

select throws_ok(
  $$
    insert into public.drive_sync_jobs (
      user_id, operation, status, document_id, idempotency_key, payload
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'upload_file',
      'pending',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'upload:cccccccc-cccc-4ccc-8ccc-cccccccccccc:v1',
      '{}'::jsonb
    )
  $$,
  '23505',
  null,
  'idempotency key prevents duplicate Drive jobs'
);

insert into public.drive_sync_jobs (
  id, user_id, operation, status, notebook_id, idempotency_key, payload
) values (
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  '11111111-1111-4111-8111-111111111111',
  'rename_folder',
  'pending',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'rename:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:v1',
  '{"name":"Biologia atualizada"}'::jsonb
);

insert into public.drive_conflicts (
  user_id,
  job_id,
  document_id,
  kind,
  local_snapshot,
  remote_snapshot
) values (
  '11111111-1111-4111-8111-111111111111',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'ambiguous_order',
  '{"version":"8"}'::jsonb,
  '{"version":"9"}'::jsonb
);

select is(
  (select status::text from public.drive_sync_jobs where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
  'pending',
  'a conflict on one item does not block an unrelated job'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is_empty(
  $$ select user_id from public.drive_connections $$,
  'another authorized user cannot read the owner Drive connection'
);

select throws_ok(
  $$
    insert into public.notebooks (
      user_id, parent_notebook_id, name, drive_folder_id
    ) values (
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Cruzado',
      '0ACrossOwnerFolderId_123456789'
    )
  $$,
  '23503',
  null,
  'nested notebook cannot reference a parent owned by another user'
);

select * from finish();
rollback;
