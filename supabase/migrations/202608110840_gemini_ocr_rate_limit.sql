-- Keep Gemini OCR calls below the provider RPM ceiling across concurrent Edge Function isolates.
-- Only service_role may reserve slots; authenticated clients cannot consume the shared budget directly.

create table public.ocr_provider_rate_state (
  model text primary key check (model ~ '^[A-Za-z0-9._-]{3,128}$'),
  next_available_at timestamptz not null default '-infinity'::timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.ocr_provider_rate_state enable row level security;
alter table public.ocr_provider_rate_state force row level security;

revoke all on table public.ocr_provider_rate_state from public, anon, authenticated;
grant all on table public.ocr_provider_rate_state to service_role;

create or replace function public.reserve_ocr_provider_rate_slot(
  target_model text,
  target_rpm integer,
  max_wait_ms integer default 20000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  available_at timestamptz;
  now_at timestamptz;
  slot_at timestamptz;
  wait_ms integer;
  spacing interval;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('allowed', false, 'waitMs', 0);
  end if;

  if target_model is null
    or target_model !~ '^[A-Za-z0-9._-]{3,128}$'
    or target_rpm not between 1 and 60
    or max_wait_ms not between 0 and 60000
  then
    return jsonb_build_object('allowed', false, 'waitMs', 0);
  end if;

  spacing := make_interval(secs => 60.0 / target_rpm::double precision);

  insert into public.ocr_provider_rate_state (model)
  values (target_model)
  on conflict (model) do nothing;

  select state.next_available_at
    into available_at
    from public.ocr_provider_rate_state state
   where state.model = target_model
   for update;

  now_at := clock_timestamp();
  slot_at := greatest(available_at, now_at);
  wait_ms := greatest(
    0,
    ceil(extract(epoch from (slot_at - now_at)) * 1000)::integer
  );

  if wait_ms > max_wait_ms then
    return jsonb_build_object('allowed', false, 'waitMs', least(wait_ms, 60000));
  end if;

  update public.ocr_provider_rate_state
     set next_available_at = slot_at + spacing,
         updated_at = timezone('utc', now())
   where model = target_model;

  return jsonb_build_object('allowed', true, 'waitMs', wait_ms);
end;
$$;

revoke execute on function public.reserve_ocr_provider_rate_slot(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ocr_provider_rate_slot(text, integer, integer)
  to service_role;
