create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table private.drive_oauth_states (
  state_hash text primary key
    check (
      char_length(state_hash) = 43
      and state_hash ~ '^[A-Za-z0-9_-]+$'
    ),
  user_id uuid not null references auth.users(id) on delete cascade,
  nonce text not null
    check (
      char_length(nonce) between 43 and 128
      and nonce ~ '^[A-Za-z0-9_-]+$'
    ),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index drive_oauth_states_user_idx
  on private.drive_oauth_states (user_id, created_at desc);

create index drive_oauth_states_expiry_idx
  on private.drive_oauth_states (expires_at);

create table private.drive_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null
    check (
      char_length(refresh_token) between 8 and 8192
      and refresh_token !~ '[[:cntrl:]]'
    ),
  google_subject text not null
    check (
      char_length(google_subject) between 6 and 255
      and google_subject ~ '^[A-Za-z0-9:_-]+$'
    ),
  google_email text not null
    check (
      char_length(google_email) between 3 and 320
      and google_email !~ '[[:space:]]'
      and google_email like '%@%'
    ),
  granted_scope text not null
    check (
      granted_scope = 'openid email https://www.googleapis.com/auth/drive.file'
    ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger drive_credentials_set_updated_at
before update on private.drive_credentials
for each row execute function public.set_updated_at();

revoke all on table private.drive_oauth_states from public, anon, authenticated;
revoke all on table private.drive_credentials from public, anon, authenticated;

create or replace function public.store_drive_oauth_state(
  target_user_id uuid,
  target_state_hash text,
  target_nonce text,
  target_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null
    or target_state_hash is null
    or char_length(target_state_hash) <> 43
    or target_state_hash !~ '^[A-Za-z0-9_-]+$'
    or target_nonce is null
    or char_length(target_nonce) not between 43 and 128
    or target_nonce !~ '^[A-Za-z0-9_-]+$'
    or target_expires_at is null
  then
    raise invalid_parameter_value using message = 'Invalid Drive OAuth state';
  end if;

  if not exists (
    select 1
    from public.app_users as app_user
    where app_user.user_id = target_user_id
      and app_user.is_active
  ) then
    raise insufficient_privilege using message = 'Drive OAuth user is not authorized';
  end if;

  delete from private.drive_oauth_states
  where expires_at <= timezone('utc', now());

  insert into private.drive_oauth_states (
    state_hash,
    user_id,
    nonce,
    expires_at
  ) values (
    target_state_hash,
    target_user_id,
    target_nonce,
    target_expires_at
  );

  return true;
end;
$$;

create or replace function public.consume_drive_oauth_state(
  target_state_hash text,
  consumed_at timestamptz
)
returns table (
  user_id uuid,
  nonce text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed_user_id uuid;
  consumed_nonce text;
  consumed_expires_at timestamptz;
begin
  if target_state_hash is null
    or char_length(target_state_hash) <> 43
    or target_state_hash !~ '^[A-Za-z0-9_-]+$'
    or consumed_at is null
  then
    raise invalid_parameter_value using message = 'Invalid Drive OAuth state consumption';
  end if;

  delete from private.drive_oauth_states as state
  where state.state_hash = target_state_hash
  returning state.user_id, state.nonce, state.expires_at
  into consumed_user_id, consumed_nonce, consumed_expires_at;

  if consumed_user_id is null or consumed_expires_at <= consumed_at then
    return;
  end if;

  return query select consumed_user_id, consumed_nonce;
end;
$$;

create or replace function public.store_drive_credential(
  target_user_id uuid,
  target_refresh_token text,
  target_google_subject text,
  target_google_email text,
  target_scope text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null
    or target_refresh_token is null
    or char_length(target_refresh_token) not between 8 and 8192
    or target_refresh_token ~ '[[:cntrl:]]'
    or target_google_subject is null
    or char_length(target_google_subject) not between 6 and 255
    or target_google_subject !~ '^[A-Za-z0-9:_-]+$'
    or target_google_email is null
    or char_length(target_google_email) not between 3 and 320
    or target_google_email ~ '[[:space:]]'
    or target_google_email not like '%@%'
    or target_scope <> 'openid email https://www.googleapis.com/auth/drive.file'
  then
    raise invalid_parameter_value using message = 'Invalid Drive OAuth credential';
  end if;

  if not exists (
    select 1
    from public.app_users as app_user
    where app_user.user_id = target_user_id
      and app_user.is_active
  ) then
    raise insufficient_privilege using message = 'Drive OAuth user is not authorized';
  end if;

  insert into private.drive_credentials (
    user_id,
    refresh_token,
    google_subject,
    google_email,
    granted_scope
  ) values (
    target_user_id,
    target_refresh_token,
    target_google_subject,
    lower(target_google_email),
    target_scope
  )
  on conflict (user_id) do update
  set
    refresh_token = excluded.refresh_token,
    google_subject = excluded.google_subject,
    google_email = excluded.google_email,
    granted_scope = excluded.granted_scope;

  insert into public.drive_connections (
    user_id,
    status,
    google_subject,
    google_email,
    last_error_code,
    last_error_message
  ) values (
    target_user_id,
    'connecting',
    target_google_subject,
    lower(target_google_email),
    null,
    null
  )
  on conflict (user_id) do update
  set
    status = 'connecting',
    google_subject = excluded.google_subject,
    google_email = excluded.google_email,
    last_error_code = null,
    last_error_message = null;

  return true;
end;
$$;

create or replace function public.get_drive_refresh_token(target_user_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select credential.refresh_token
  from private.drive_credentials as credential
  join public.app_users as app_user
    on app_user.user_id = credential.user_id
   and app_user.is_active
  where credential.user_id = target_user_id;
$$;

revoke all on function public.store_drive_oauth_state(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_drive_oauth_state(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.store_drive_credential(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_drive_refresh_token(uuid)
  from public, anon, authenticated;

grant execute on function public.store_drive_oauth_state(uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.consume_drive_oauth_state(text, timestamptz)
  to service_role;
grant execute on function public.store_drive_credential(uuid, text, text, text, text)
  to service_role;
grant execute on function public.get_drive_refresh_token(uuid)
  to service_role;
