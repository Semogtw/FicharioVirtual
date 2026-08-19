begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select is(
  public.gemini_ocr_next_rpd_reset('2026-08-14T20:00:00Z'::timestamptz),
  '2026-08-15T07:00:00Z'::timestamptz,
  'Gemini RPD resets at Pacific midnight during daylight saving time'
);

select is(
  public.gemini_ocr_next_rpd_reset('2026-12-14T20:00:00Z'::timestamptz),
  '2026-12-15T08:00:00Z'::timestamptz,
  'Gemini RPD resets at Pacific midnight during standard time'
);

select is(
  has_function_privilege('anon', 'public.reserve_ocr_provider_rate_slot(text,integer,integer)', 'EXECUTE'),
  false,
  'anon cannot reserve provider budget'
);
select is(
  has_function_privilege('authenticated', 'public.reserve_ocr_provider_rate_slot(text,integer,integer)', 'EXECUTE'),
  false,
  'authenticated clients cannot reserve provider budget directly'
);
select is(
  has_function_privilege('service_role', 'public.reserve_ocr_provider_rate_slot(text,integer,integer)', 'EXECUTE'),
  true,
  'service role owns provider budget reservation'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

delete from public.ocr_provider_rate_state
where model in ('gemini-rpd-primary-test', 'gemini-rpd-fallback-test');

select lives_ok(
  $test$
    do $$
    declare
      reservation jsonb;
      reservation_index integer;
    begin
      for reservation_index in 1..190 loop
        update public.ocr_provider_rate_state
        set next_available_at = clock_timestamp()
        where model = 'gemini-rpd-primary-test';

        select public.reserve_ocr_provider_rate_slot('gemini-rpd-primary-test', 60, 0)
        into reservation;

        if (reservation ->> 'allowed')::boolean is distinct from true then
          raise exception 'daily reservation % was unexpectedly blocked: %', reservation_index, reservation;
        end if;
      end loop;
    end;
    $$;
  $test$,
  'the first 190 daily reservations fit the primary model budget'
);

select is(
  (select daily_request_count from public.ocr_provider_rate_state where model = 'gemini-rpd-primary-test'),
  190,
  'the primary model tracks exactly 190 daily provider requests'
);

create temporary table exhausted_primary as
select public.reserve_ocr_provider_rate_slot('gemini-rpd-primary-test', 60, 60000) as reservation;

select is(
  ((select reservation from exhausted_primary) ->> 'allowed')::boolean,
  false,
  'the 191st primary reservation is blocked before contacting Gemini'
);

select ok(
  ((select reservation from exhausted_primary) ->> 'waitMs')::integer > 60000,
  'daily exhaustion returns a long deferral instead of an RPM-sized retry'
);

create temporary table fallback_first as
select public.reserve_ocr_provider_rate_slot('gemini-rpd-fallback-test', 60, 60000) as reservation;

select is(
  ((select reservation from fallback_first) ->> 'allowed')::boolean,
  true,
  'an exhausted primary budget does not consume or block the fallback model budget'
);

select is(
  (select daily_request_count from public.ocr_provider_rate_state where model = 'gemini-rpd-fallback-test'),
  1,
  'fallback model maintains an independent daily counter'
);

reset role;

select has_trigger(
  'public',
  'ocr_provider_usage_events',
  'sync_gemini_daily_quota_from_telemetry',
  'provider daily-quota telemetry closes the shared per-model circuit breaker'
);

select * from finish();
rollback;
