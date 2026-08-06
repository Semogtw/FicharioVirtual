#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

node tools/checks/check-tracked-secrets.mjs
node tools/checks/check-source-security.mjs
node tools/checks/check-migrations.mjs
node tools/checks/check-rpc-types.mjs
node tools/checks/check-ci-bootstrap.mjs
node tools/checks/check-static-routing.mjs
node tools/checks/check-provider-only-ocr.mjs

echo "Offline source gates completed."
