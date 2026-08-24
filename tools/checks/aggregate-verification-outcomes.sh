#!/usr/bin/env bash
set -euo pipefail

if (($# == 0)); then
	echo 'At least one verification outcome is required.' >&2
	exit 2
fi

failures=()
for entry in "$@"; do
	if [[ "$entry" != *=* || "${entry%%=*}" == '' || "${entry#*=}" == '' ]]; then
		echo "Invalid verification outcome: $entry" >&2
		exit 2
	fi

	name="${entry%%=*}"
	outcome="${entry#*=}"
	printf '%s=%s\n' "$name" "$outcome"
	if [[ "$outcome" != 'success' ]]; then
		failures+=("$name=$outcome")
	fi
done

if ((${#failures[@]} > 0)); then
	echo "Verification failed for ${#failures[@]} gate(s):" >&2
	printf ' - %s\n' "${failures[@]}" >&2
	exit 1
fi

echo 'All required verification gates succeeded.'
