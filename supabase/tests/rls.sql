begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'other@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'inactive@example.test');

insert into public.app_users (user_id, is_active)
values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true),
  ('33333333-3333-4333-8333-333333333333', false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select lives_ok(
  $$
    insert into public.notebooks (id, user_id, name)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'Biologia'
    )
  $$,
  'authorized owner can create a notebook'
);

select results_eq(
  $$ select name from public.notebooks order by name $$,
  $$ values ('Biologia'::text) $$,
  'owner reads the owned notebook'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is_empty(
  $$ select id from public.notebooks $$,
  'another authorized user cannot read the owner notebook'
);

select results_eq(
  $$
    with changed as (
      update public.notebooks set name = 'Invadido'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      returning id
    )
    select count(*)::bigint from changed
  $$,
  $$ values (0::bigint) $$,
  'another user cannot update the owner notebook'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

select throws_ok(
  $$
    insert into public.notebooks (user_id, name)
    values ('33333333-3333-4333-8333-333333333333', 'Bloqueado')
  $$,
  '42501',
  'new row violates row-level security policy for table "notebooks"',
  'inactive allowlist entry cannot create data'
);

reset role;
set local role anon;

select throws_ok(
  $$ select id from public.documents $$,
  '42501',
  'permission denied for table documents',
  'anonymous role has no document table access'
);

reset role;

insert into public.notebooks (id, user_id, name)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '22222222-2222-4222-8222-222222222222',
  'Outro caderno'
);

select throws_ok(
  $$
    insert into public.documents (
      id, user_id, notebook_id, title, kind, original_filename, storage_path
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'Relação cruzada',
      'pdf',
      'cross.pdf',
      '11111111-1111-4111-8111-111111111111/cross.pdf'
    )
  $$,
  '23503',
  null,
  'composite foreign key rejects a notebook from another user'
);

insert into public.documents (
  id,
  user_id,
  notebook_id,
  title,
  kind,
  original_filename,
  storage_path,
  page_count,
  status
) values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Fotossíntese',
  'pdf',
  'fotossintese.pdf',
  '11111111-1111-4111-8111-111111111111/fotossintese.pdf',
  1,
  'ready'
);

insert into public.pages (
  id,
  user_id,
  document_id,
  page_number,
  native_text,
  extraction_source,
  status
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '11111111-1111-4111-8111-111111111111',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  1,
  'A fotossíntese ocorre no cloroplasto.',
  'native_pdf',
  'ready'
);

select is(
  (select normalized_text from public.pages where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  'a fotossintese ocorre no cloroplasto.',
  'page trigger normalizes accents for search'
);

update public.pages
set corrected_text = 'A fotossíntese acontece nos cloroplastos.'
where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

select is(
  (select normalized_text from public.pages where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  'a fotossintese acontece nos cloroplastos.',
  'corrected text becomes the effective indexed text'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select results_eq(
  $$
    select document_title
    from public.search_pages('fotossintese', null, 10, 0)
  $$,
  $$ values ('Fotossíntese'::text) $$,
  'accentless search finds accented content'
);

select results_eq(
  $$
    select document_title
    from public.search_pages('cloroplasto', null, 10, 0)
  $$,
  $$ values ('Fotossíntese'::text) $$,
  'word search finds the corrected page text'
);

select is_empty(
  $$
    select document_title
    from public.search_pages('conteudo inexistente', null, 10, 0)
  $$,
  'unrelated search does not return a document'
);

select * from finish();
rollback;
