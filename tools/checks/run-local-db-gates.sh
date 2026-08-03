#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

command -v supabase >/dev/null 2>&1 || {
  echo "Supabase CLI is required to run local database gates." >&2
  exit 1
}
command -v psql >/dev/null 2>&1 || {
  echo "PostgreSQL psql is required to run local database gates." >&2
  exit 1
}

supabase start >/dev/null
supabase db reset
supabase test db

bash tools/checks/test-ocr-claim-contracts.sh
bash tools/checks/test-ocr-claim-concurrency.sh
bash tools/checks/test-ocr-idempotency.sh

echo "Local database gates completed."
