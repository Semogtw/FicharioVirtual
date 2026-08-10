begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

select has_schema('private', 'private OAuth schema exists');
select has_table('private', 'drive_oauth_states', 'OAuth states are stored outside public');
select has_table('private', 'drive_credentials', 'Drive refresh tokens are stored outside public');
select has_column(
  'private',
  'drive_oauth_states',
  'code_verifier',
  'OAuth state storage can bind a backend-only PKCE verifier'
);

select ok(
  not has_table_privilege('anon', 'private.drive_oauth_states', 'select'),
  'anon cannot read OAuth states'
);
select ok(
  not has_table_privilege('authenticated', 'private.drive_oauth_states', 'select'),
  'authenticated users cannot read OAuth states'
);
select ok(
  not has_table_privilege('anon', 'private.drive_credentials', 'select'),
  'anon cannot read Drive credentials'
);
select ok(
  not has_table_privilege('authenticated', 'private.drive_credentials', 'select'),
  'authenticated users cannot read Drive credentials'
);

insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'oauth-owner@example.test');
insert into public.app_users (user_id, is_active)
values ('11111111-1111-4111-8111-111111111111', true);

select is(
  public.store_drive_oauth_state(
    '11111111-1111-4111-8111-111111111111',
    repeat('a', 43),
    repeat('b', 43),
    timezone('utc', now()) + interval '10 minutes'
  ),
  true,
  'service path stores a valid one-time OAuth state'
);

select results_eq(
  $$
    select user_id, nonce
    from public.consume_drive_oauth_state(repeat('a', 43), timezone('utc', now()))
  $$,
  $$
    values ('11111111-1111-4111-8111-111111111111'::uuid, repeat('b', 43)::text)
  $$,
  'valid OAuth state is consumed with its user and nonce'
);

select is_empty(
  $$
    select user_id, nonce
    from public.consume_drive_oauth_state(repeat('a', 43), timezone('utc', now()))
  $$,
  'OAuth state cannot be replayed'
);

select is(
  public.store_drive_oauth_state(
    '11111111-1111-4111-8111-111111111111',
    repeat('c', 43),
    repeat('d', 43),
    timezone('utc', now()) - interval '1 second'
  ),
  true,
  'expired state can be inserted for deterministic expiry testing'
);

select is_empty(
  $$
    select user_id, nonce
    from public.consume_drive_oauth_state(repeat('c', 43), timezone('utc', now()))
  $$,
  'expired OAuth state is rejected and removed'
);

select is(
  public.store_drive_oauth_state_pkce(
    '11111111-1111-4111-8111-111111111111',
    repeat('e', 43),
    repeat('f', 43),
    repeat('v', 43),
    timezone('utc', now()) + interval '10 minutes'
  ),
  true,
  'service path stores a PKCE-bound OAuth state'
);

select is_empty(
  $$
    select user_id, nonce
    from public.consume_drive_oauth_state(repeat('e', 43), timezone('utc', now()))
  $$,
  'legacy callback cannot consume a PKCE-bound OAuth state'
);

select results_eq(
  $$
    select user_id, nonce, code_verifier
    from public.consume_drive_oauth_state_pkce(repeat('e', 43), timezone('utc', now()))
  $$,
  $$
    values (
      '11111111-1111-4111-8111-111111111111'::uuid,
      repeat('f', 43)::text,
      repeat('v', 43)::text
    )
  $$,
  'PKCE callback consumes the matching verifier exactly once'
);

select is_empty(
  $$
    select user_id, nonce, code_verifier
    from public.consume_drive_oauth_state_pkce(repeat('e', 43), timezone('utc', now()))
  $$,
  'PKCE-bound OAuth state cannot be replayed'
);

select is(
  public.store_drive_oauth_state(
    '11111111-1111-4111-8111-111111111111',
    repeat('g', 43),
    repeat('h', 43),
    timezone('utc', now()) + interval '10 minutes'
  ),
  true,
  'legacy state can coexist during a staggered rollout'
);

select is_empty(
  $$
    select user_id, nonce, code_verifier
    from public.consume_drive_oauth_state_pkce(repeat('g', 43), timezone('utc', now()))
  $$,
  'PKCE callback cannot consume a legacy state without a verifier'
);

select results_eq(
  $$
    select user_id, nonce
    from public.consume_drive_oauth_state(repeat('g', 43), timezone('utc', now()))
  $$,
  $$
    values ('11111111-1111-4111-8111-111111111111'::uuid, repeat('h', 43)::text)
  $$,
  'legacy callback can still consume only its own legacy state'
);

select is(
  public.store_drive_credential(
    '11111111-1111-4111-8111-111111111111',
    'refresh-token-kept-in-private-schema',
    'google-user-subject-123456789',
    'oauth-owner@example.test',
    'openid email https://www.googleapis.com/auth/drive.file'
  ),
  true,
  'refresh token is stored through the service-only function'
);

select is(
  public.get_drive_refresh_token('11111111-1111-4111-8111-111111111111'),
  'refresh-token-kept-in-private-schema',
  'service-only accessor returns the private refresh token'
);

select results_eq(
  $$
    select status::text, google_subject, google_email
    from public.drive_connections
    where user_id = '11111111-1111-4111-8111-111111111111'
  $$,
  $$
    values (
      'connecting'::text,
      'google-user-subject-123456789'::text,
      'oauth-owner@example.test'::text
    )
  $$,
  'credential storage updates only the public connection projection'
);

select is(
  public.complete_drive_connection(
    '11111111-1111-4111-8111-111111111111',
    '0AExampleRootFolderId_123456789',
    'initial-change-token'
  ),
  true,
  'service path promotes an authorized connection after Drive bootstrap'
);

select results_eq(
  $$
    select status::text, root_folder_id, start_page_token, next_page_token
    from public.drive_connections
    where user_id = '11111111-1111-4111-8111-111111111111'
  $$,
  $$
    values (
      'connected'::text,
      '0AExampleRootFolderId_123456789'::text,
      'initial-change-token'::text,
      null::text
    )
  $$,
  'completed connection persists only public Drive bootstrap state'
);

select * from finish();
rollback;
