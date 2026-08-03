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
    END {
      if (value == "") exit 1
      print value
    }
  ' "$@"
}

validate_claim_shape() {
  node - "$1" <<'NODE'
const claim = JSON.parse(process.argv[2]);
const keys = Object.keys(claim).sort().join(',');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (claim.state === 'claimed') {
  if (
    keys !== 'attemptCount,jobId,state,usageToday' ||
    !uuid.test(claim.jobId) ||
    !Number.isInteger(claim.attemptCount) ||
    claim.attemptCount < 1 ||
    !Number.isInteger(claim.usageToday) ||
    claim.usageToday < 1
  ) process.exit(1);
  process.exit(0);
}
if (claim.state === 'quota_exhausted') {
  if (
    keys !== 'jobId,nextRetryAt,state' ||
    !uuid.test(claim.jobId) ||
    typeof claim.nextRetryAt !== 'string' ||
    !Number.isFinite(Date.parse(claim.nextRetryAt))
  ) process.exit(1);
  process.exit(0);
}
process.exit(1);
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
select public.claim_ocr_job(
  '$page_id'::uuid,
  'gemini-test',
  now(),
  1
)::text;
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
state_a="$(node -e 'const claim=JSON.parse(process.argv[1]); process.stdout.write(String(claim.state ?? ""));' "$claim_a")"
state_b="$(node -e 'const claim=JSON.parse(process.argv[1]); process.stdout.write(String(claim.state ?? ""));' "$claim_b")"

validate_claim_shape "$claim_a" || {
  echo "Concurrent claim A contract drifted: $claim_a" >&2
  exit 1
}
validate_claim_shape "$claim_b" || {
  echo "Concurrent claim B contract drifted: $claim_b" >&2
  exit 1
}
if ! {
  [[ "$state_a" == "claimed" && "$state_b" == "quota_exhausted" ]] ||
    [[ "$state_a" == "quota_exhausted" && "$state_b" == "claimed" ]]
}; then
  echo "Expected one claimed and one quota_exhausted state, received: $state_a, $state_b" >&2
  exit 1
fi

reserved_count="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 -c \
    "select ocr_pages from public.usage_daily where user_id='$user_id'::uuid and usage_date=(timezone('utc',now()))::date"
)"
if [[ "$reserved_count" != "1" ]]; then
  echo "Expected one reserved OCR page, received: $reserved_count" >&2
  exit 1
fi

claimed_attempt_count="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 -c \
    "select attempt_count from public.ocr_jobs where user_id='$user_id'::uuid and status='processing' limit 1"
)"
if [[ "$claimed_attempt_count" != "1" ]]; then
  echo "Expected the provider-bound claim to count one attempt, received: $claimed_attempt_count" >&2
  exit 1
fi

blocked_page="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 -c \
    "select page_id from public.ocr_jobs where user_id='$user_id'::uuid and status='blocked_quota' limit 1"
)"
if [[ -z "$blocked_page" ]]; then
  echo "Expected one locally quota-blocked page." >&2
  exit 1
fi

blocked_attempt_count="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 -c \
    "select attempt_count from public.ocr_jobs where page_id='$blocked_page'::uuid"
)"
if [[ "$blocked_attempt_count" != "0" ]]; then
  echo "Local quota must not consume a provider attempt, received: $blocked_attempt_count" >&2
  exit 1
fi

scheduled_count="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 -c \
    "select count(*) from public.ocr_jobs where page_id='$blocked_page'::uuid and next_retry_at=((date_trunc('day', timezone('utc', now())) + interval '1 day') at time zone 'utc')"
)"
if [[ "$scheduled_count" != "1" ]]; then
  echo "Local quota block was not scheduled for the next UTC day." >&2
  exit 1
fi

same_day_state="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 <<SQL | parse_claim_value
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$user_id', true);
select public.claim_ocr_job(
  '$blocked_page'::uuid,
  'gemini-test',
  now(),
  1
)->>'state';
commit;
SQL
)"
if [[ "$same_day_state" != "retry_later" ]]; then
  echo "Expected local quota retry_later, received: $same_day_state" >&2
  exit 1
fi

echo "OCR claim concurrency test passed."
