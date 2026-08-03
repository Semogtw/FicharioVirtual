#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

command -v deno >/dev/null 2>&1 || {
  echo "Deno is required to check Supabase Edge Functions." >&2
  exit 1
}

deno check --no-config supabase/functions/_shared/cors.ts
deno check --no-config supabase/functions/_shared/ocr-contract.ts
deno check --no-config supabase/functions/_shared/gemini-ocr-client.ts
deno check --no-config supabase/functions/_shared/ocr-failure.ts
deno check --no-config supabase/functions/process-ocr/index.ts
deno check --no-config supabase/functions/delete-document/index.ts

echo "Edge Function type checks completed."
