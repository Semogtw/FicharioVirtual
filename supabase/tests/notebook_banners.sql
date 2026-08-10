begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'banner-owner@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'banner-other@example.test');

insert into public.app_users (user_id, is_active)
values
  ('11111111-1111-4111-8111-111111111111', true),
  ('22222222-2222-4222-8222-222222222222', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

insert into public.notebooks (id, user_id, name)
values (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'Biologia'
);

select results_eq(
  $$
    select banner_path, banner_position_x::integer, banner_position_y::integer
      from public.notebooks
     where id = '33333333-3333-4333-8333-333333333333'
  $$,
  $$ values (null::text, 50::integer, 50::integer) $$,
  'new notebooks default to no banner centered at 50/50'
);

select lives_ok(
  $$
    update public.notebooks
       set banner_path = '11111111-1111-4111-8111-111111111111/notebook-banners/33333333-3333-4333-8333-333333333333/banner.webp',
           banner_position_x = 38,
           banner_position_y = 64
     where id = '33333333-3333-4333-8333-333333333333'
  $$,
  'an owner can persist a private notebook banner path and focal point'
);

select results_eq(
  $$
    select banner_path, banner_position_x::integer, banner_position_y::integer, document_count
      from public.list_notebooks()
     where id = '33333333-3333-4333-8333-333333333333'
  $$,
  $$
    values (
      '11111111-1111-4111-8111-111111111111/notebook-banners/33333333-3333-4333-8333-333333333333/banner.webp'::text,
      38::integer,
      64::integer,
      0::bigint
    )
  $$,
  'list_notebooks exposes banner metadata without exposing another user'
);

select throws_ok(
  $$
    update public.notebooks
       set banner_path = '22222222-2222-4222-8222-222222222222/notebook-banners/33333333-3333-4333-8333-333333333333/banner.webp'
     where id = '33333333-3333-4333-8333-333333333333'
  $$,
  '23514',
  null,
  'banner paths cannot escape the owning user namespace'
);

select throws_ok(
  $$
    update public.notebooks
       set banner_position_x = -1
     where id = '33333333-3333-4333-8333-333333333333'
  $$,
  '23514',
  null,
  'horizontal focal position must stay inside 0..100'
);

select throws_ok(
  $$
    update public.notebooks
       set banner_position_y = 101
     where id = '33333333-3333-4333-8333-333333333333'
  $$,
  '23514',
  null,
  'vertical focal position must stay inside 0..100'
);

select ok(
  has_function_privilege('authenticated', 'public.list_notebooks()', 'EXECUTE'),
  'authenticated users can execute the notebook listing RPC'
);

select ok(
  not has_function_privilege('anon', 'public.list_notebooks()', 'EXECUTE'),
  'anonymous callers cannot execute the notebook listing RPC'
);

select * from finish();
rollback;
