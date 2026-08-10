#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
source_dir="$repo_root/tools/desktop-worker"
unit_source="$repo_root/packaging/systemd/fichario-ocr-worker-safe.service"
install_dir="$HOME/.local/lib/fichario-worker"
bin_dir="$HOME/.local/bin"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_path="$unit_dir/fichario-ocr-worker.service"

fail() {
  printf 'fichario-worker install failed: %s\n' "$1" >&2
  exit 1
}

warn() {
  printf 'fichario-worker install warning: %s\n' "$1" >&2
}

command -v node >/dev/null 2>&1 || fail 'node is required'
command -v systemctl >/dev/null 2>&1 || fail 'systemctl is required'
[[ -f "$unit_source" ]] || fail 'hardened systemd unit is missing'
for entrypoint in bin.mjs config-bin.mjs pair-bin.mjs unpair-bin.mjs model-bin.mjs status-bin.mjs; do
  [[ -f "$source_dir/$entrypoint" ]] || fail "worker entrypoint is missing: $entrypoint"
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" =~ ^[0-9]+$ ]] || fail 'unable to determine node version'
(( node_major >= 22 )) || fail 'Node.js 22 or newer is required'

if [[ ! -x /usr/bin/secret-tool ]]; then
  warn 'Secret Service client /usr/bin/secret-tool is missing; install libsecret before pairing'
fi

install -d -m 0700 "$install_dir"
find "$install_dir" -maxdepth 1 -type f -name '*.mjs' -delete
while IFS= read -r -d '' module; do
  install -m 0600 "$module" "$install_dir/$(basename -- "$module")"
done < <(find "$source_dir" -maxdepth 1 -type f -name '*.mjs' -print0 | sort -z)
chmod 0700 \
  "$install_dir/bin.mjs" \
  "$install_dir/config-bin.mjs" \
  "$install_dir/pair-bin.mjs" \
  "$install_dir/unpair-bin.mjs" \
  "$install_dir/model-bin.mjs" \
  "$install_dir/status-bin.mjs"

install -d -m 0700 "$bin_dir"
ln -sfn ../lib/fichario-worker/bin.mjs "$bin_dir/fichario-worker"
ln -sfn ../lib/fichario-worker/config-bin.mjs "$bin_dir/fichario-worker-config"
ln -sfn ../lib/fichario-worker/pair-bin.mjs "$bin_dir/fichario-worker-pair"
ln -sfn ../lib/fichario-worker/unpair-bin.mjs "$bin_dir/fichario-worker-unpair"
ln -sfn ../lib/fichario-worker/model-bin.mjs "$bin_dir/fichario-worker-model"
ln -sfn ../lib/fichario-worker/status-bin.mjs "$bin_dir/fichario-worker-status"

install -d -m 0700 "$unit_dir"
install -m 0600 "$unit_source" "$unit_path"
systemctl --user daemon-reload

printf '%s\n' \
  'Fichário OCR worker installed for the current user.' \
  'The service was NOT enabled or started.' \
  'Run setup in order: fichario-worker-config, fichario-worker-model, fichario-worker-pair, fichario-worker-status.' \
  'Only after readyToRun=true: systemctl --user enable --now fichario-ocr-worker.service'
