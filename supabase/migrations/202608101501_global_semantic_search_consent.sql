alter table public.app_users
  add column if not exists search_semantic_consent_at timestamptz,
  add column if not exists search_semantic_consent_version integer;

alter table public.app_users
  drop constraint if exists app_users_search_semantic_consent_consistent;
alter table public.app_users
  add constraint app_users_search_semantic_consent_consistent check (
    (search_semantic_consent_at is null and search_semantic_consent_version is null)
    or (
      search_semantic_consent_at is not null
      and search_semantic_consent_version between 1 and 10000
    )
  );

create or replace function public.record_search_semantic_consent(consent_version integer default 1)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  changed_rows integer;
begin
  if current_user_id is null or consent_version < 1 or consent_version > 10000 then
    return false;
  end if;

  update public.app_users
  set search_semantic_consent_at = timezone('utc', now()),
      search_semantic_consent_version = greatest(
        coalesce(search_semantic_consent_version, 0),
        consent_version
      ),
      updated_at = timezone('utc', now())
  where user_id = current_user_id
    and is_active = true;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

create or replace function public.has_search_semantic_consent(consent_version integer default 1)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users
    where user_id = (select auth.uid())
      and is_active = true
      and search_semantic_consent_at is not null
      and search_semantic_consent_version >= consent_version
  );
$$;

revoke execute on function public.record_search_semantic_consent(integer) from public, anon;
revoke execute on function public.has_search_semantic_consent(integer) from public, anon;
grant execute on function public.record_search_semantic_consent(integer) to authenticated;
grant execute on function public.has_search_semantic_consent(integer) to authenticated;
