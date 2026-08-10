#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

output_name="${1:-fichario-deploy}"
if [[ ! "$output_name" =~ ^[A-Za-z0-9._-]+$ || "$output_name" == '.' || "$output_name" == '..' ]]; then
  echo 'artifact output must be a simple repository-local directory name' >&2
  exit 1
fi

source_commit="${GITHUB_SHA:-}"
if [[ ! "$source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'GITHUB_SHA must contain the full lowercase source commit' >&2
  exit 1
fi

if [[ "${TARGET_ENVIRONMENT:-}" != 'staging' ]]; then
  echo 'deployment artifacts are staging-only until production infrastructure exists' >&2
  exit 1
fi

for required in \
  build/200.html \
  build/_headers \
  build/manifest.webmanifest \
  build/registerSW.js \
  build/sw.js \
  package.json \
  pnpm-lock.yaml \
  tools/checks/check-deployed-site.mjs \
  tools/checks/deployment-contract.mjs \
  tools/checks/check-deployment-artifact.mjs \
  tools/checks/validate-pages-deploy-output.mjs; do
  if [[ ! -f "$required" ]]; then
    echo "cannot package deployment artifact: missing $required" >&2
    exit 1
  fi
done

rm -rf -- "$output_name"
mkdir -p "$output_name/site" "$output_name/source" "$output_name/checks"
cp -a build/. "$output_name/site/"
cp package.json pnpm-lock.yaml "$output_name/source/"
cp \
  tools/checks/check-deployed-site.mjs \
  tools/checks/deployment-contract.mjs \
  tools/checks/check-deployment-artifact.mjs \
  tools/checks/validate-pages-deploy-output.mjs \
  "$output_name/checks/"

{
  echo 'schema_version=2'
  echo 'source_repository=Semogtw/FicharioVirtual'
  echo "source_commit=$source_commit"
  echo 'target_environment=staging'
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "node_version=$(node --version)"
  echo "pnpm_version=$(pnpm --version)"
  echo "package_sha256=$(sha256sum "$output_name/source/package.json" | cut -d' ' -f1)"
  echo "lock_sha256=$(sha256sum "$output_name/source/pnpm-lock.yaml" | cut -d' ' -f1)"
} > "$output_name/DEPLOYMENT-MANIFEST.txt"

(
  cd "$output_name"
  find . -type l -print -quit | grep -q . && {
    echo 'deployment artifact must not contain symbolic links' >&2
    exit 1
  }
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
  sha256sum -c SHA256SUMS
)

printf 'Packaged staging deployment artifact at %s\n' "$output_name"
