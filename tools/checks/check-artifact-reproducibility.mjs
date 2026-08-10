#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const packagerPath = resolve(root, 'tools/deploy/package-static-artifact.sh');
const source = await readFile(packagerPath, 'utf8');
const failures = [];

function requireText(text, detail) {
	if (!source.includes(text)) failures.push(detail);
}

function forbidText(text, detail) {
	if (source.includes(text)) failures.push(detail);
}

requireText(
	'source_date_epoch="${SOURCE_DATE_EPOCH:-}"',
	'packager must honor the standard SOURCE_DATE_EPOCH override'
);
requireText(
	'git show -s --format=%ct "$source_commit"',
	'packager must derive its default timestamp from the immutable source commit'
);
requireText(
	'if [[ ! "$source_date_epoch" =~ ^[0-9]+$ ]]',
	'packager must reject a non-integer reproducible timestamp'
);
requireText(
	'created_utc="$(\n  node -e',
	'packager must canonicalize the reproducible timestamp before writing the manifest'
);
requireText(
	'echo "created_utc=$created_utc"',
	'manifest creation time must use the reproducible timestamp'
);
forbidText(
	'created_utc=$(date ',
	'packager must not derive manifest identity from the runner wall clock'
);
forbidText(
	'created_utc="$(date ',
	'packager must not derive manifest identity from the runner wall clock'
);

if (failures.length > 0) {
	console.error(`Artifact reproducibility checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Artifact reproducibility checks passed.');
}