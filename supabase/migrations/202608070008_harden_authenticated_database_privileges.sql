-- Supabase grants broad default table privileges in the public schema.
-- RLS still protects row-oriented CRUD, but it does not protect operations such as TRUNCATE.
-- Keep client roles at the application privileges explicitly required by this project.

alter function public.is_authorized_user() security invoker;
alter function public.clear_temporary_page_image(uuid, text) security invoker;
alter function public.complete_ocr_job(uuid, text, jsonb, text, timestamptz) security invoker;
alter function public.fail_ocr_job(uuid, text, text, boolean, timestamptz, timestamptz) security invoker;

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
