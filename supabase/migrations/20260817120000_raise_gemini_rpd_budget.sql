-- Raise the local per-model Gemini circuit breaker to 190 RPD.
-- The provider remains authoritative: a real daily-quota error still closes the
-- model until the next Pacific reset, while this local guard leaves a small
-- margin below the expected 200 RPD project limit.

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
  provider_daily_limit constant integer := 190;
  available_at timestamptz;
  now_at timestamptz;
  slot_at timestamptz;
  wait_ms integer;
  spacing interval;
  daily_count integer;
  reset_at timestamptz;
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

  now_at := clock_timestamp();
  spacing := make_interval(secs => 60.0 / target_rpm::double precision);

  insert into public.ocr_provider_rate_state (
    model,
    daily_request_count,
    daily_reset_at
  ) values (
    target_model,
    0,
    public.gemini_ocr_next_rpd_reset(now_at)
  )
  on conflict (model) do nothing;

  select
    state.next_available_at,
    state.daily_request_count,
    state.daily_reset_at
  into
    available_at,
    daily_count,
    reset_at
  from public.ocr_provider_rate_state state
  where state.model = target_model
  for update;

  -- A Pacific-time rollover reopens the model exactly once under the same row lock.
  if reset_at <= now_at then
    daily_count := 0;
    reset_at := public.gemini_ocr_next_rpd_reset(now_at);
    update public.ocr_provider_rate_state
       set daily_request_count = 0,
           daily_reset_at = reset_at,
           updated_at = timezone('utc', now())
     where model = target_model;
  end if;

  -- Do not touch the provider after the local daily budget is exhausted. The long
  -- wait is returned to the application so the primary model can fall back while
  -- the fallback model, if also exhausted, can remain queued until reset.
  if daily_count >= provider_daily_limit then
    wait_ms := greatest(
      1000,
      ceil(extract(epoch from (reset_at - now_at)) * 1000)::integer
    );
    return jsonb_build_object(
      'allowed', false,
      'waitMs', least(wait_ms, 172800000)
    );
  end if;

  slot_at := greatest(available_at, now_at);
  wait_ms := greatest(
    0,
    ceil(extract(epoch from (slot_at - now_at)) * 1000)::integer
  );

  -- Normal RPM pressure never consumes RPD because no provider request will occur.
  if wait_ms > max_wait_ms then
    return jsonb_build_object('allowed', false, 'waitMs', least(wait_ms, 60000));
  end if;

  update public.ocr_provider_rate_state
     set next_available_at = slot_at + spacing,
         daily_request_count = daily_count + 1,
         daily_reset_at = reset_at,
         updated_at = timezone('utc', now())
   where model = target_model;

  return jsonb_build_object('allowed', true, 'waitMs', wait_ms);
end;
$$;

revoke execute on function public.reserve_ocr_provider_rate_slot(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ocr_provider_rate_slot(text, integer, integer)
  to service_role;

-- A provider-reported daily quota closes the same 190-request circuit breaker.
create or replace function public.sync_gemini_daily_quota_from_telemetry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_reset_at timestamptz;
begin
  if new.provider <> 'gemini'
    or new.status <> 'error'
    or new.safe_error_code <> 'gemini_daily_quota'
  then
    return new;
  end if;

  provider_reset_at := public.gemini_ocr_next_rpd_reset(new.created_at);
  if provider_reset_at <= clock_timestamp() then
    return new;
  end if;

  insert into public.ocr_provider_rate_state (
    model,
    daily_request_count,
    daily_reset_at,
    updated_at
  ) values (
    new.model,
    190,
    provider_reset_at,
    timezone('utc', now())
  )
  on conflict (model) do update
     set daily_request_count = greatest(public.ocr_provider_rate_state.daily_request_count, 190),
         daily_reset_at = greatest(public.ocr_provider_rate_state.daily_reset_at, excluded.daily_reset_at),
         updated_at = excluded.updated_at;

  return new;
end;
$$;

revoke execute on function public.sync_gemini_daily_quota_from_telemetry()
  from public, anon, authenticated, service_role;

drop trigger if exists sync_gemini_daily_quota_from_telemetry
  on public.ocr_provider_usage_events;
create trigger sync_gemini_daily_quota_from_telemetry
after insert on public.ocr_provider_usage_events
for each row
execute function public.sync_gemini_daily_quota_from_telemetry();
