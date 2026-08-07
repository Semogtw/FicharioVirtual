-- Supabase grants broad default table privileges in the public schema.
-- RLS still protects row-oriented CRUD, but it does not protect operations such as TRUNCATE.
-- Keep client roles at the application privileges explicitly required by this project.

alter function public.is_authorized_user() security invoker;
alter function public.clear_temporary_page_image(uuid, text) security invoker;
alter function public.complete_ocr_job(uuid, text, jsonb, text, timestamptz) security invoker;
alter function public.fail_ocr_job(uuid, text, text, boolean, timestamptz, timestamptz) security invoker;

-- Quota blocking legitimately needs elevated access to usage_daily, but an authenticated
-- caller must still be an active allowlisted user before that privilege is exercised.
create or replace function public.block_ocr_job_quota(
  target_page_id uuid,
  error_code text,
  blocked_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job_id uuid;
  next_utc_day timestamptz := (
    date_trunc('day', blocked_at at time zone 'utc') + interval '1 day'
  ) at time zone 'utc';
begin
  if current_user_id is null
    or not (select public.is_authorized_user())
    or error_code !~ '^[a-z0-9_]{1,64}$'
  then
    return false;
  end if;

  select id into target_job_id
  from public.ocr_jobs
  where page_id = target_page_id
    and user_id = current_user_id
    and status = 'processing'
  for update;

  if not found then return false; end if;

  update public.ocr_jobs
  set status = 'blocked_quota',
      last_error_code = error_code,
      last_error_message = 'A cota diária do provedor foi atingida.',
      next_retry_at = next_utc_day,
      started_at = null,
      finished_at = null
  where id = target_job_id;

  update public.pages
  set status = 'blocked_quota'
  where id = target_page_id and user_id = current_user_id;

  insert into public.usage_daily (
    user_id,
    usage_date,
    quota_errors,
    updated_at
  ) values (
    current_user_id,
    (blocked_at at time zone 'utc')::date,
    1,
    blocked_at
  )
  on conflict (user_id, usage_date) do update
  set quota_errors = public.usage_daily.quota_errors + 1,
      updated_at = excluded.updated_at;

  return true;
end;
$$;

revoke execute on function public.block_ocr_job_quota(uuid, text, timestamptz) from public, anon;
grant execute on function public.block_ocr_job_quota(uuid, text, timestamptz) to authenticated;

-- Prevent new public tables created by the migration role from inheriting administrative
-- privileges that authenticated application clients do not need.
alter default privileges in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;

-- Preserve each table's existing CRUD contract while stripping privileges that bypass
-- or sit outside row-level authorization. Doing this dynamically also covers newer
-- application tables without accidentally re-granting DML revoked by earlier hardening.
do $$
declare
  application_table regclass;
begin
  for application_table in
    select relation.oid::regclass
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
  loop
    execute format(
      'revoke truncate, references, trigger, maintain on table %s from authenticated',
      application_table
    );
  end loop;
end;
$$;

-- Usage is mutated only by validated RPC capability boundaries. Authenticated clients
-- may inspect their own counters through RLS but cannot forge quota/accounting state.
revoke all on table public.usage_daily from authenticated;
grant select on table public.usage_daily to authenticated;
