alter table private.drive_oauth_states
  add column if not exists code_verifier text;

alter table private.drive_oauth_states
  drop constraint if exists drive_oauth_states_code_verifier_check;

alter table private.drive_oauth_states
  add constraint drive_oauth_states_code_verifier_check
  check (
    code_verifier is null
    or (
      char_length(code_verifier) between 43 and 128
      and code_verifier ~ '^[A-Za-z0-9._~-]+$'
    )
  );

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
    and state.code_verifier is null
  returning state.user_id, state.nonce, state.expires_at
  into consumed_user_id, consumed_nonce, consumed_expires_at;

  if consumed_user_id is null or consumed_expires_at <= consumed_at then
    return;
  end if;

  return query select consumed_user_id, consumed_nonce;
end;
$$;

create or replace function public.store_drive_oauth_state_pkce(
  target_user_id uuid,
  target_state_hash text,
  target_nonce text,
  target_code_verifier text,
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
    or target_code_verifier is null
    or char_length(target_code_verifier) not between 43 and 128
    or target_code_verifier !~ '^[A-Za-z0-9._~-]+$'
    or target_expires_at is null
  then
    raise invalid_parameter_value using message = 'Invalid Drive OAuth PKCE state';
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
    code_verifier,
    expires_at
  ) values (
    target_state_hash,
    target_user_id,
    target_nonce,
    target_code_verifier,
    target_expires_at
  );

  return true;
end;
$$;

create or replace function public.consume_drive_oauth_state_pkce(
  target_state_hash text,
  consumed_at timestamptz
)
returns table (
  user_id uuid,
  nonce text,
  code_verifier text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed_user_id uuid;
  consumed_nonce text;
  consumed_code_verifier text;
  consumed_expires_at timestamptz;
begin
  if target_state_hash is null
    or char_length(target_state_hash) <> 43
    or target_state_hash !~ '^[A-Za-z0-9_-]+$'
    or consumed_at is null
  then
    raise invalid_parameter_value using message = 'Invalid Drive OAuth PKCE state consumption';
  end if;

  delete from private.drive_oauth_states as state
  where state.state_hash = target_state_hash
    and state.code_verifier is not null
  returning state.user_id, state.nonce, state.code_verifier, state.expires_at
  into consumed_user_id, consumed_nonce, consumed_code_verifier, consumed_expires_at;

  if consumed_user_id is null or consumed_expires_at <= consumed_at then
    return;
  end if;

  return query select consumed_user_id, consumed_nonce, consumed_code_verifier;
end;
$$;

revoke execute on function public.consume_drive_oauth_state(text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.store_drive_oauth_state_pkce(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.consume_drive_oauth_state_pkce(text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.consume_drive_oauth_state(text, timestamptz)
  to service_role;
grant execute on function public.store_drive_oauth_state_pkce(uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.consume_drive_oauth_state_pkce(text, timestamptz)
  to service_role;
