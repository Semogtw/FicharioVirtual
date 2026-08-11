#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

output_name="${1:-fichario-deploy}"
if [[ ! "$output_name" =~ ^fichario-deploy(-[A-Za-z0-9][A-Za-z0-9._-]*)?$ ]]; then
  echo 'artifact output must be fichario-deploy or a fichario-deploy-* repository-local directory' >&2
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

source_date_epoch="${SOURCE_DATE_EPOCH:-}"
if [[ -z "$source_date_epoch" ]]; then
  source_date_epoch="$(git show -s --format=%ct "$source_commit" 2>/dev/null || true)"
fi
if [[ ! "$source_date_epoch" =~ ^[0-9]+$ ]]; then
  echo 'SOURCE_DATE_EPOCH must be an integer Unix timestamp or derivable from GITHUB_SHA' >&2
  exit 1
fi
created_utc="$(
  node -e '
    const epoch = Number(process.argv[1]);
    const instant = new Date(epoch * 1000);
    if (!Number.isSafeInteger(epoch) || Number.isNaN(instant.getTime())) process.exit(1);
    process.stdout.write(instant.toISOString().replace(".000Z", "Z"));
  ' "$source_date_epoch"
)" || {
  echo 'SOURCE_DATE_EPOCH is outside the supported timestamp range' >&2
  exit 1
}

for required in \
  build/200.html \
  build/_headers \
  build/manifest.webmanifest \
  build/registerSW.js \
  build/sw.js \
  package.json \
  pnpm-lock.yaml \
  tools/checks/check-deployed-site.mjs \
  tools/checks/check-deployed-ui.mjs \
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
  tools/checks/check-deployed-ui.mjs \
  tools/checks/deployment-contract.mjs \
  tools/checks/check-deployment-artifact.mjs \
  tools/checks/validate-pages-deploy-output.mjs \
  "$output_name/checks/"

{
  echo 'schema_version=2'
  echo 'source_repository=Semogtw/FicharioVirtual'
  echo "source_commit=$source_commit"
  echo 'target_environment=staging'
  echo "created_utc=$created_utc"
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