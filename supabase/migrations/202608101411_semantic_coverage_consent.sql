alter table public.app_users
  add column if not exists coverage_semantic_consent_at timestamptz,
  add column if not exists coverage_semantic_consent_version integer;

alter table public.app_users
  drop constraint if exists app_users_coverage_semantic_consent_consistent;
alter table public.app_users
  add constraint app_users_coverage_semantic_consent_consistent check (
    (coverage_semantic_consent_at is null and coverage_semantic_consent_version is null)
    or (
      coverage_semantic_consent_at is not null
      and coverage_semantic_consent_version between 1 and 10000
    )
  );

create or replace function public.record_coverage_semantic_consent(consent_version integer default 1)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if consent_version < 1 or consent_version > 10000 then
    raise exception 'Invalid semantic consent version';
  end if;
  update public.app_users
  set
    coverage_semantic_consent_at = now(),
    coverage_semantic_consent_version = consent_version,
    updated_at = now()
  where user_id = (select auth.uid())
    and is_active = true;
  return found;
end;
$$;

create or replace function public.has_coverage_semantic_consent(consent_version integer default 1)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users
    where user_id = (select auth.uid())
      and is_active = true
      and coverage_semantic_consent_at is not null
      and coverage_semantic_consent_version = consent_version
  );
$$;

revoke execute on function public.record_coverage_semantic_consent(integer) from public, anon;
revoke execute on function public.has_coverage_semantic_consent(integer) from public, anon;
grant execute on function public.record_coverage_semantic_consent(integer) to authenticated;
grant execute on function public.has_coverage_semantic_consent(integer) to authenticated;
