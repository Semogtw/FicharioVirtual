#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

command -v deno >/dev/null 2>&1 || {
  echo "Deno is required to check Supabase Edge Functions." >&2
  exit 1
}

deno check --no-config supabase/functions/_shared/cors.ts
deno check --no-config supabase/functions/_shared/desktop-worker-auth.ts
deno check --no-config supabase/functions/_shared/desktop-worker-contract.ts
deno check --no-config supabase/functions/_shared/ocr-contract.ts
deno check --no-config supabase/functions/_shared/ocr-batch-contract.ts
deno check --no-config supabase/functions/_shared/gemini-ocr-client.ts
deno check --no-config supabase/functions/_shared/gemini-embedding-client.ts
deno check --no-config supabase/functions/_shared/gemini-coverage-verifier.ts
deno check --no-config supabase/functions/_shared/semantic-chunks.ts
deno check --no-config supabase/functions/_shared/ocr-failure.ts
deno check --no-config supabase/functions/_shared/google-oauth.ts
deno check --no-config supabase/functions/_shared/google-oauth-http.ts
deno check --no-config supabase/functions/_shared/google-drive-client.ts
deno check --no-config supabase/functions/_shared/google-drive-changes.ts
deno check --no-config supabase/functions/_shared/google-drive-mutations.ts
deno check --no-config supabase/functions/_shared/drive-folder-chain.ts
deno check --no-config supabase/functions/_shared/drive-job-runner.ts
deno check --no-config supabase/functions/process-ocr/index.ts
deno check --no-config supabase/functions/semantic-coverage/index.ts
deno check --no-config supabase/functions/delete-document/index.ts
deno check --no-config supabase/functions/drive-oauth-start/index.ts
deno check --no-config supabase/functions/drive-oauth-callback/index.ts
deno check --no-config supabase/functions/drive-access-token/index.ts
deno check --no-config supabase/functions/drive-resolve-folder/index.ts
deno check --no-config supabase/functions/drive-run-jobs/index.ts
deno check --no-config supabase/functions/drive-sync/index.ts
deno check --no-config supabase/functions/desktop-ocr-pair/index.ts
deno check --no-config supabase/functions/desktop-ocr-worker/index.ts

echo "Edge Function type checks completed."
