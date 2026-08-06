#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
db_url="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
user_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
page_a="22222222-2222-4222-8222-222222222222"
page_b="55555555-5555-4555-8555-555555555555"
temporary_directory="$(mktemp -d)"

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
  rm -rf "$temporary_directory"
}
trap cleanup EXIT

parse_claim_value() {
  awk '
    NF && $0 != "BEGIN" && $0 != "COMMIT" && $0 != "SET" && $0 !~ /^aaaaaaaa-/ {
      value = $0
    }
    END { if (value == "") exit 1; print value }
  ' "$@"
}

validate_claim_shape() {
  node - "$1" <<'NODE'
const claim = JSON.parse(process.argv[2]);
const keys = Object.keys(claim).sort().join(',');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (
  claim.state !== 'claimed' ||
  keys !== 'attemptCount,jobId,state,usageToday' ||
  !uuid.test(claim.jobId) ||
  !Number.isInteger(claim.attemptCount) ||
  claim.attemptCount < 1 ||
  !Number.isInteger(claim.usageToday) ||
  claim.usageToday < 1
) process.exit(1);
NODE
}

psql "$db_url" -v ON_ERROR_STOP=1 \
  -f "$repo_root/tools/checks/fixtures/ocr-concurrency-fixture.sql" >/dev/null

claim() {
  local page_id="$1"
  local output_path="$2"
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 >"$output_path" <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$user_id', true);
select public.claim_ocr_job('$page_id'::uuid, 'gemini-test', now())::text;
commit;
SQL
}

claim "$page_a" "$temporary_directory/claim-a.out" &
pid_a=$!
claim "$page_b" "$temporary_directory/claim-b.out" &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

claim_a="$(parse_claim_value "$temporary_directory/claim-a.out")"
claim_b="$(parse_claim_value "$temporary_directory/claim-b.out")"
validate_claim_shape "$claim_a" || { echo "Concurrent claim A contract drifted: $claim_a" >&2; exit 1; }
validate_claim_shape "$claim_b" || { echo "Concurrent claim B contract drifted: $claim_b" >&2; exit 1; }

reserved_count="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 -c \
    "select ocr_pages from public.usage_daily where user_id='$user_id'::uuid and usage_date=(timezone('utc',now()))::date"
)"
if [[ "$reserved_count" != "2" ]]; then
  echo "Both provider-bound claims must be counted informationally; received: $reserved_count" >&2
  exit 1
fi

processing_count="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 -c \
    "select count(*) from public.ocr_jobs where user_id='$user_id'::uuid and status='processing' and attempt_count=1"
)"
if [[ "$processing_count" != "2" ]]; then
  echo "Expected two independent provider-bound claims, received: $processing_count" >&2
  exit 1
fi

local_quota_count="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 -c \
    "select count(*) from public.ocr_jobs where user_id='$user_id'::uuid and status='blocked_quota'"
)"
if [[ "$local_quota_count" != "0" ]]; then
  echo "The application must not create a local quota block." >&2
  exit 1
fi

echo "Provider-only OCR claim concurrency test passed."
