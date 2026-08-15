#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
db_url="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
user_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

cleanup() {
  psql "$db_url" -v ON_ERROR_STOP=1 >/dev/null <<SQL || true
-- Every fixture-owned table references auth.users with ON DELETE CASCADE.
-- Delete the owner row so newly added fixture tables cannot survive cleanup.
delete from auth.users where id = '$user_id'::uuid;
SQL
}
trap cleanup EXIT

psql "$db_url" -v ON_ERROR_STOP=1 \
  -f "$repo_root/tools/checks/fixtures/ocr-concurrency-fixture.sql" >/dev/null

psql "$db_url" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

do $$
declare
  first_claim jsonb;
  replay_claim jsonb;
  quota_claim jsonb;
  same_day_claim jsonb;
  next_day_claim jsonb;
  blocked boolean;
  provider_retry_at timestamptz;
  persisted_text text;
  same_day_resumable_count integer;
  next_day_resumable_count integer;
  day_one_count integer;
  day_two_count integer;
begin
  first_claim := public.claim_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'gemini-test',
    '2026-08-01T12:00:00Z'::timestamptz
  );
  if first_claim->>'state' <> 'claimed' then
    raise exception 'expected first claim, got %', first_claim;
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(first_claim) as keys(key))
    is distinct from array['attemptCount', 'jobId', 'state', 'usageToday']
    or jsonb_typeof(first_claim->'attemptCount') <> 'number'
    or jsonb_typeof(first_claim->'usageToday') <> 'number'
  then
    raise exception 'first claim contract drifted: %', first_claim;
  end if;

  perform public.complete_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'Texto confirmado',
    '[]'::jsonb,
    'ready',
    '2026-08-01T12:01:00Z'::timestamptz
  );

  perform public.complete_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'Texto confirmado',
    '[]'::jsonb,
    'ready',
    '2026-08-01T12:01:00Z'::timestamptz
  );

  begin
    perform public.complete_ocr_job(
      '22222222-2222-4222-8222-222222222222'::uuid,
      'Texto divergente',
      '[]'::jsonb,
      'ready',
      '2026-08-01T12:01:00Z'::timestamptz
    );
    raise exception 'conflicting completion replay was accepted';
  exception
    when sqlstate '22023' then
      null;
  end;

  select ocr_raw_text into persisted_text
  from public.pages
  where id = '22222222-2222-4222-8222-222222222222'::uuid;
  if persisted_text is distinct from 'Texto confirmado' then
    raise exception 'conflicting replay changed persisted OCR text: %', persisted_text;
  end if;

  replay_claim := public.claim_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'gemini-test',
    '2026-08-01T12:02:00Z'::timestamptz
  );
  if replay_claim->>'state' <> 'already_complete' then
    raise exception 'response-loss reconciliation failed: %', replay_claim;
  end if;
  if (select array_agg(key order by key) from jsonb_object_keys(replay_claim) as keys(key))
    is distinct from array['jobId', 'state']
  then
    raise exception 'already-complete claim contract drifted: %', replay_claim;
  end if;

  quota_claim := public.claim_ocr_job(
    '55555555-5555-4555-8555-555555555555'::uuid,
    'gemini-test',
    '2026-08-01T12:03:00Z'::timestamptz
  );
  if quota_claim->>'state' <> 'claimed' then
    raise exception 'expected provider-quota setup claim, got %', quota_claim;
  end if;

  blocked := public.block_ocr_job_quota(
    '55555555-5555-4555-8555-555555555555'::uuid,
    'gemini_daily_quota',
    '2026-08-01T12:04:00Z'::timestamptz
  );
  if blocked is distinct from true then
    raise exception 'provider quota terminal was not accepted';
  end if;

  -- 2026-08-01 uses PDT (UTC-07), so the next Gemini provider day begins
  -- at 2026-08-02T07:00:00Z rather than at midnight UTC.
  select next_retry_at into provider_retry_at
  from public.ocr_jobs
  where page_id = '55555555-5555-4555-8555-555555555555'::uuid;
  if provider_retry_at is distinct from '2026-08-02T07:00:00Z'::timestamptz then
    raise exception 'provider quota retry was not scheduled for next Pacific day: %', provider_retry_at;
  end if;

  same_day_claim := public.claim_ocr_job(
    '55555555-5555-4555-8555-555555555555'::uuid,
    'gemini-test',
    '2026-08-02T06:59:59Z'::timestamptz
  );
  if same_day_claim->>'state' <> 'retry_later' then
    raise exception 'provider quota retried before Pacific rollover: %', same_day_claim;
  end if;

  select count(*) into same_day_resumable_count
  from public.list_resumable_ocr_pages(
    '11111111-1111-4111-8111-111111111111'::uuid,
    '2026-08-02T06:59:59Z'::timestamptz
  );
  if same_day_resumable_count <> 0 then
    raise exception 'quota-blocked page was selectable before retry time';
  end if;

  select count(*) into next_day_resumable_count
  from public.list_resumable_ocr_pages(
    '11111111-1111-4111-8111-111111111111'::uuid,
    '2026-08-02T07:00:01Z'::timestamptz
  );
  if next_day_resumable_count <> 1 then
    raise exception 'quota-blocked page was not selectable after Pacific rollover';
  end if;

  next_day_claim := public.claim_ocr_job(
    '55555555-5555-4555-8555-555555555555'::uuid,
    'gemini-test',
    '2026-08-02T07:00:01Z'::timestamptz
  );
  if next_day_claim->>'state' <> 'claimed' then
    raise exception 'Pacific day rollover did not release provider quota: %', next_day_claim;
  end if;
  if (next_day_claim->>'attemptCount')::integer < 1
    or (next_day_claim->>'usageToday')::integer <> 1
  then
    raise exception 'next-day claim contract drifted: %', next_day_claim;
  end if;

  select ocr_pages into day_one_count
  from public.usage_daily
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    and usage_date = '2026-08-01'::date;
  select ocr_pages into day_two_count
  from public.usage_daily
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    and usage_date = '2026-08-02'::date;

  if day_one_count <> 2 or day_two_count <> 1 then
    raise exception 'unexpected UTC counters: %, %', day_one_count, day_two_count;
  end if;
end;
$$;

commit;
SQL

echo "OCR completion replay and provider quota rollover test passed."
