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
delete from public.ocr_batches where user_id = '$user_id'::uuid;
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
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
do $$
declare result jsonb;
begin
  result := public.claim_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'gemini-test',
    '2026-08-03T00:00:00Z'
  );
  if result is distinct from jsonb_build_object('state', 'not_authorized') then
    raise exception 'not-authorized claim contract drifted: %', result;
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
do $$
declare result jsonb;
begin
  result := public.claim_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'x',
    '2026-08-03T00:00:02Z'
  );
  if result is distinct from jsonb_build_object('state', 'invalid_configuration') then
    raise exception 'invalid-configuration claim contract drifted: %', result;
  end if;

  result := public.claim_ocr_job(
    '77777777-7777-4777-8777-777777777777'::uuid,
    'gemini-test',
    '2026-08-03T00:00:03Z'
  );
  if result is distinct from jsonb_build_object('state', 'not_found') then
    raise exception 'not-found claim contract drifted: %', result;
  end if;

  result := public.claim_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'gemini-test',
    '2026-08-03T00:00:04Z'
  );
  if result->>'state' is distinct from 'claimed' then
    raise exception 'busy setup claim failed: %', result;
  end if;

  result := public.claim_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'gemini-test',
    '2026-08-03T00:00:05Z'
  );
  if (select array_agg(key order by key) from jsonb_object_keys(result) as keys(key))
    is distinct from array['jobId', 'state']
    or result->>'state' is distinct from 'busy'
    or (result->>'jobId')::uuid is null
  then
    raise exception 'busy claim contract drifted: %', result;
  end if;
end;
$$;
reset role;

update public.ocr_jobs
set status = 'failed',
    next_retry_at = null,
    finished_at = '2026-08-03T00:00:06Z'
where page_id = '22222222-2222-4222-8222-222222222222'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
do $$
declare result jsonb;
begin
  result := public.claim_ocr_job(
    '22222222-2222-4222-8222-222222222222'::uuid,
    'gemini-test',
    '2026-08-03T00:00:07Z'
  );
  if (select array_agg(key order by key) from jsonb_object_keys(result) as keys(key))
    is distinct from array['jobId', 'state']
    or result->>'state' is distinct from 'not_retryable'
    or (result->>'jobId')::uuid is null
  then
    raise exception 'not-retryable claim contract drifted: %', result;
  end if;
end;
$$;
reset role;

rollback;
SQL

echo "Provider-only OCR simple claim result contracts passed."
