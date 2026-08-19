begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email)
values
  ('aaaaaaaa-1111-4111-8111-111111111111', 'owner-profile@example.test'),
  ('bbbbbbbb-2222-4222-8222-222222222222', 'public-profile@example.test'),
  ('cccccccc-3333-4333-8333-333333333333', 'inactive-profile@example.test');

insert into public.app_users (user_id, is_active, provider_profile)
values
  ('aaaaaaaa-1111-4111-8111-111111111111', true, 'owner'),
  ('cccccccc-3333-4333-8333-333333333333', false, 'public');

select ok(
  has_function_privilege('authenticated', 'public.ensure_current_app_user()', 'EXECUTE'),
  'authenticated users may enroll their own app account'
);

select ok(
  not has_function_privilege('anon', 'public.ensure_current_app_user()', 'EXECUTE'),
  'anonymous users cannot enroll app accounts'
);

select ok(
  not has_function_privilege('anon', 'public.current_provider_profile()', 'EXECUTE'),
  'anonymous users cannot resolve provider profiles'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-2222-4222-8222-222222222222', true);

select is(
  public.ensure_current_app_user(),
  'public'::text,
  'a new authenticated user is enrolled as public'
);

select is(
  (select provider_profile from public.app_users where user_id = 'bbbbbbbb-2222-4222-8222-222222222222'),
  'public'::text,
  'self-enrollment persists only the public provider profile'
);

select is(
  public.current_provider_profile(),
  'public'::text,
  'the public user resolves the public provider profile'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1111-4111-8111-111111111111', true);

select is(
  public.ensure_current_app_user(),
  'owner'::text,
  'enrollment never downgrades an existing owner account'
);

select is(
  public.current_provider_profile(),
  'owner'::text,
  'the existing owner keeps the private provider profile'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-3333-4333-8333-333333333333', true);

select is(
  public.ensure_current_app_user(),
  null::text,
  'an inactive account cannot reactivate itself through enrollment'
);

select is(
  public.current_provider_profile(),
  null::text,
  'inactive accounts fail closed when resolving provider profile'
);

select * from finish();
rollback;
