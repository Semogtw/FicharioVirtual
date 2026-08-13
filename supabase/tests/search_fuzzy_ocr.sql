begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email)
values ('44444444-4444-4444-8444-444444444444', 'fuzzy-search@example.test');

insert into public.app_users (user_id, is_active)
values ('44444444-4444-4444-8444-444444444444', true);

insert into public.documents (
  id,
  user_id,
  title,
  kind,
  original_filename,
  storage_path,
  page_count,
  status
) values (
  '55555555-5555-4555-8555-555555555555',
  '44444444-4444-4444-8444-444444444444',
  'Biologia celular',
  'image',
  'pagina.png',
  '44444444-4444-4444-8444-444444444444/pagina.png',
  2,
  'ready'
);

insert into public.pages (
  id,
  user_id,
  document_id,
  page_number,
  ocr_raw_text,
  extraction_source,
  status
) values
  (
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    1,
    'A fotossintcse transforma energia luminosa em energia química.',
    'ocr',
    'ready'
  ),
  (
    '77777777-7777-4777-8777-777777777777',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    2,
    'Uma palavra ocitona tem tonicidade na última sílaba.',
    'ocr',
    'ready'
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);

select results_eq(
  $$
    select document_title
    from public.search_pages('fotossíntese', null, 10, 0)
  $$,
  $$ values ('Biologia celular'::text) $$,
  'fuzzy search recovers a page containing an OCR typo'
);

select ok(
  position(
    'fotossintcse' in (
      select excerpt
      from public.search_pages('fotossíntese', null, 10, 0)
      limit 1
    )
  ) > 0,
  'the result excerpt contains the OCR token that motivated the fuzzy match'
);

select results_eq(
  $$
    select page_number
    from public.search_pages('oxitona', null, 10, 0)
  $$,
  $$ values (2) $$,
  'single-character OCR substitutions such as ocitona/oxitona remain searchable'
);

select is_empty(
  $$
    select document_title
    from public.search_pages('termodistante', null, 10, 0)
  $$,
  'fuzzy search does not admit an unrelated token'
);

select * from finish();
rollback;
