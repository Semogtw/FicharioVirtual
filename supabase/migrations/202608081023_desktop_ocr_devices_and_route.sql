create type public.ocr_route as enum ('gemini', 'desktop');

alter table public.ocr_jobs
  add column route public.ocr_route not null default 'gemini';

create index ocr_jobs_owner_route_status_created_idx
  on public.ocr_jobs (user_id, route, status, created_at, id);

create table public.ocr_worker_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (
    char_length(label) between 1 and 80
    and label = btrim(label)
  ),
  credential_hash bytea not null unique check (octet_length(credential_hash) = 32),
  status text not null default 'active' check (status in ('active', 'revoked')),
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id),
  constraint ocr_worker_devices_status_shape check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create index ocr_worker_devices_owner_status_idx
  on public.ocr_worker_devices (user_id, status, created_at, id);

create index ocr_worker_devices_owner_last_seen_idx
  on public.ocr_worker_devices (user_id, last_seen_at desc nulls last);

alter table public.ocr_worker_devices enable row level security;

revoke all on table public.ocr_worker_devices from public, anon, authenticated;
grant all on table public.ocr_worker_devices to service_role;

create or replace function public.list_ocr_worker_devices()
returns table (
  device_id uuid,
  label text,
  status text,
  capabilities jsonb,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or not public.is_authorized_user() then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  return query
  select
    device.id,
    device.label,
    device.status,
    device.capabilities,
    device.last_seen_at,
    device.revoked_at,
    device.created_at,
    device.updated_at
  from public.ocr_worker_devices as device
  where device.user_id = current_user_id
  order by device.created_at, device.id;
end;
$$;

revoke execute on function public.list_ocr_worker_devices() from public;
revoke execute on function public.list_ocr_worker_devices() from anon;
grant execute on function public.list_ocr_worker_devices() to authenticated;
grant execute on function public.list_ocr_worker_devices() to service_role;
