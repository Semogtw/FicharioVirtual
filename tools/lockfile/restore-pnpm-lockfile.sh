#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

archive_dir="tools/lockfile"
shopt -s nullglob
parts=("$archive_dir"/pnpm-lock.yaml.gz.b64.part-*)
shopt -u nullglob

if (( ${#parts[@]} == 0 )); then
	echo "No pnpm lockfile archive parts found under $archive_dir." >&2
	exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

encoded="$work_dir/pnpm-lock.yaml.gz.b64"
compressed="$work_dir/pnpm-lock.yaml.gz"
restored="$work_dir/pnpm-lock.yaml"

cat "${parts[@]}" | tr -d '\r\n\t ' > "$encoded"
base64 --decode "$encoded" > "$compressed"
gzip -dc "$compressed" > "$restored"

if ! grep -q '^lockfileVersion:' "$restored"; then
	echo 'Restored archive is not a valid pnpm lockfile.' >&2
	exit 1
fi

mv "$restored" pnpm-lock.yaml
printf 'Restored pnpm-lock.yaml from %d archive parts.\n' "${#parts[@]}"
