#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
db_url="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
user_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

cleanup() {
  psql "$db_url" -v ON_ERROR_STOP=1 >/dev/null <<SQL || true
delete from public.document_tags where user_id = '$user_id'::uuid;
delete from public.tags where user_id = '$user_id'::uuid;
delete from public.usage_daily where user_id = '$user_id'::uuid;
delete from public.ocr_jobs where user_id = '$user_id'::uuid;
delete from public.pages where user_id = '$user_id'::uuid;
delete from public.documents where user_id = '$user_id'::uuid;
delete from public.notebooks where user_id = '$user_id'::uuid;
delete from public.app_users where user_id = '$user_id'::uuid;
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
  next_day_claim jsonb;
  completed boolean;
  completed_again boolean;
  day_one_count integer;
  day_two_count integer;
begin
  first_claim := public.claim_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'gemini-test',
    '2026-08-01T12:00:00Z'::timestamptz,
    1
  );
  if first_claim->>'state' <> 'claimed' then
    raise exception 'expected first claim, got %', first_claim;
  end if;

  completed := public.complete_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'Texto confirmado',
    '[]'::jsonb,
    'ready',
    '2026-08-01T12:01:00Z'::timestamptz
  );
  if completed is distinct from true then
    raise exception 'first completion was not accepted';
  end if;

  completed_again := public.complete_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'Texto confirmado',
    '[]'::jsonb,
    'ready',
    '2026-08-01T12:01:00Z'::timestamptz
  );
  if completed_again is distinct from true then
    raise exception 'exact completion replay was not idempotent';
  end if;

  replay_claim := public.claim_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'gemini-test',
    '2026-08-01T12:02:00Z'::timestamptz,
    1
  );
  if replay_claim->>'state' <> 'already_complete' then
    raise exception 'response-loss reconciliation failed: %', replay_claim;
  end if;

  next_day_claim := public.claim_ocr_job(
    '55555555-5555-4555-8555-555555555555'::uuid,
    'gemini-test',
    '2026-08-02T00:00:01Z'::timestamptz,
    1
  );
  if next_day_claim->>'state' <> 'claimed' then
    raise exception 'UTC day rollover did not reset quota: %', next_day_claim;
  end if;

  select ocr_pages into day_one_count
  from public.usage_daily
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    and usage_date = '2026-08-01'::date;
  select ocr_pages into day_two_count
  from public.usage_daily
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    and usage_date = '2026-08-02'::date;

  if day_one_count <> 1 or day_two_count <> 1 then
    raise exception 'unexpected UTC counters: %, %', day_one_count, day_two_count;
  end if;
end;
$$;

commit;
SQL

echo "OCR completion replay and UTC rollover test passed."
