-- Foundation for opening the existing Fichario deployment to public accounts without
-- duplicating the application or infrastructure. Existing allowlisted accounts keep
-- the current high-quality provider route; newly enrolled accounts are always public.

alter table public.app_users
  add column provider_profile text;

update public.app_users
set provider_profile = 'owner'
where provider_profile is null;

alter table public.app_users
  alter column provider_profile set default 'public',
  alter column provider_profile set not null;

alter table public.app_users
  add constraint app_users_provider_profile_check
  check (provider_profile in ('owner', 'public'));

-- Authenticated users may enroll only their own auth.uid(), and enrollment can never
-- grant the owner profile. Existing rows are deliberately left untouched so suspended
-- accounts cannot reactivate themselves by calling this function.
create or replace function public.ensure_current_app_user()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile text;
begin
  if current_user_id is null then
    return null;
  end if;

  insert into public.app_users (user_id, is_active, provider_profile)
  values (current_user_id, true, 'public')
  on conflict (user_id) do nothing;

  select provider_profile
  into current_profile
  from public.app_users
  where user_id = current_user_id
    and is_active = true;

  return current_profile;
end;
$$;

revoke execute on function public.ensure_current_app_user() from public, anon;
grant execute on function public.ensure_current_app_user() to authenticated;

-- Read-only server/client contract used to derive provider routing. It returns NULL
-- for missing/inactive accounts and never accepts a user id argument.
create or replace function public.current_provider_profile()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select provider_profile
  from public.app_users
  where user_id = (select auth.uid())
    and is_active = true;
$$;

revoke execute on function public.current_provider_profile() from public, anon;
grant execute on function public.current_provider_profile() to authenticated;
