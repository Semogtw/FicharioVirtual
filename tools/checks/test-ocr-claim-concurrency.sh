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
  timezone('utc', now()),
  1
)->>'state';
commit;
SQL
}

claim "$page_a" "$temporary_directory/claim-a.out" &
pid_a=$!
claim "$page_b" "$temporary_directory/claim-b.out" &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

python - "$temporary_directory/claim-a.out" "$temporary_directory/claim-b.out" <<'PY'
from pathlib import Path
import sys

states = []
for path in sys.argv[1:]:
    values = [
        value.strip()
        for value in Path(path).read_text(encoding='utf-8').splitlines()
        if value.strip()
        and value.strip() not in {'BEGIN', 'COMMIT', 'SET'}
        and not value.strip().startswith('aaaaaaaa-')
    ]
    if not values:
        raise SystemExit(f'claim produced no state: {path}')
    states.append(values[-1])

expected = ['claimed', 'quota_exhausted']
if sorted(states) != expected:
    raise SystemExit(f'expected {expected}, received {states}')
PY

reserved_count="$(
  psql "$db_url" -Atq -v ON_ERROR_STOP=1 -c \
    "select ocr_pages from public.usage_daily where user_id='$user_id'::uuid and usage_date=(timezone('utc',now()))::date"
)"
if [[ "$reserved_count" != "1" ]]; then
  echo "Expected one reserved OCR page, received: $reserved_count" >&2
  exit 1
fi

echo "OCR claim concurrency test passed."
