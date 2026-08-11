import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const workflowPath = resolve(root, '.github/workflows/build-deployment-artifact.yml');
const packagerPath = resolve(root, 'tools/deploy/package-static-artifact.sh');
const [source, packager] = await Promise.all([
	readFile(workflowPath, 'utf8'),
	readFile(packagerPath, 'utf8')
]);
const failures = [];

function requireText(haystack, text, detail) {
	if (!haystack.includes(text)) failures.push(detail);
}

function forbidText(haystack, text, detail) {
	if (haystack.includes(text)) failures.push(detail);
}

requireText(source, 'on:\n  workflow_dispatch:', 'artifact build workflow must remain manual-only');
forbidText(source, '\n  push:', 'artifact build workflow must not run on push');
forbidText(source, '\n  pull_request:', 'artifact build workflow must not run on pull requests');
forbidText(source, '\n  schedule:', 'artifact build workflow must not run on a schedule');
requireText(
	source,
	'permissions:\n  actions: read\n  contents: read',
	'artifact build workflow permissions must remain actions:read and contents:read only'
);
requireText(
	source,
	'environment: staging',
	'artifact build must use only the existing staging environment'
);
requireText(
	source,
	'TARGET_ENVIRONMENT: staging',
	'artifact build target must remain hard-coded to staging'
);
requireText(
	source,
	'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
	'checkout action must remain pinned to the reviewed commit'
);
requireText(
	source,
	'persist-credentials: false',
	'artifact checkout must not persist repository credentials'
);
requireText(
	source,
	'- name: Require green current-head validation for this SHA',
	'artifact build must require a green current-head validation before packaging'
);
requireText(
	source,
	'GH_TOKEN: ${{ github.token }}',
	'artifact validation lookup must use only the scoped GitHub workflow token'
);
requireText(
	source,
	'/git/ref/heads/main',
	'artifact build must bind the requested SHA to the current main ref'
);
requireText(
	source,
	'if [[ "$main_sha" != "$GITHUB_SHA" ]]',
	'artifact build must reject stale or non-main workflow dispatches'
);
requireText(
	source,
	'/actions/workflows/validate-current-head.yml/runs?head_sha=${GITHUB_SHA}&status=completed',
	'artifact build must query completed current-head validation runs for the exact SHA'
);
requireText(
	source,
	'.event == \\"push\\" and .conclusion == \\"success\\"',
	'artifact build must accept only successful push validation evidence'
);
requireText(
	source,
	'No successful Validate current head push run exists',
	'artifact build must fail closed when exact-SHA validation evidence is missing'
);
requireText(
	source,
	'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
	'pnpm setup action must remain pinned to the reviewed commit'
);
requireText(
	source,
	'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
	'Node setup action must remain pinned to the reviewed commit'
);
requireText(
	source,
	'pnpm install --frozen-lockfile',
	'artifact build must install only from the committed lockfile'
);
requireText(
	source,
	'PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}',
	'artifact build must obtain the public Supabase URL from staging'
);
requireText(
	source,
	'PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.PUBLIC_SUPABASE_PUBLISHABLE_KEY }}',
	'artifact build must obtain the publishable Supabase key from staging'
);
requireText(
	source,
	'PUBLIC_GOOGLE_CLIENT_ID: ${{ secrets.PUBLIC_GOOGLE_CLIENT_ID }}',
	'artifact build must keep Google Picker client ID environment-scoped'
);
requireText(
	source,
	'PUBLIC_GOOGLE_PICKER_API_KEY: ${{ secrets.PUBLIC_GOOGLE_PICKER_API_KEY }}',
	'artifact build must keep Google Picker API key environment-scoped'
);
requireText(
	source,
	'PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: ${{ secrets.PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER }}',
	'artifact build must keep Google Picker project number environment-scoped'
);
requireText(
	source,
	'run: node tools/checks/check-staging-public-config.mjs',
	'artifact build must use the shared fail-closed staging public configuration checker'
);
requireText(
	source,
	'run: pnpm verify',
	'artifact build must execute the full repository verify command'
);
for (const publicValue of [
	'PUBLIC_SUPABASE_URL',
	'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
	'PUBLIC_GOOGLE_CLIENT_ID',
	'PUBLIC_GOOGLE_PICKER_API_KEY',
	'PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER'
]) {
	requireText(
		source,
		`grep -R -F -- "$${publicValue}" build >/dev/null`,
		`artifact build must prove ${publicValue} is frozen into the static output`
	);
}
requireText(
	source,
	`! grep -R -F '127.0.0.1:54321' build`,
	'artifact build must reject the local Supabase URL'
);
requireText(
	source,
	`! grep -R -F 'sb_publishable_test_key_1234567890' build`,
	'artifact build must reject the development publishable key'
);
requireText(
	source,
	'run: bash tools/deploy/package-static-artifact.sh fichario-deploy',
	'artifact workflow must use the shared deterministic packager'
);
requireText(
	source,
	'run: pnpm test:deployment:artifact -- fichario-deploy',
	'artifact contract must pass before upload'
);
requireText(
	source,
	'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
	'artifact upload action must remain pinned to the reviewed commit'
);
requireText(
	source,
	'name: fichario-static-${{ github.sha }}-staging',
	'artifact identity must bind source SHA to staging'
);
requireText(
	source,
	'if-no-files-found: error',
	'missing deployment artifact must fail the workflow'
);

requireText(packager, 'set -euo pipefail', 'shared packager must remain fail-fast');
requireText(
	packager,
	'if [[ ! "$output_name" =~ ^fichario-deploy(-[A-Za-z0-9][A-Za-z0-9._-]*)?$ ]]',
	'packager output must remain confined to the dedicated fichario-deploy namespace'
);
requireText(
	packager,
	'if [[ ! "$source_commit" =~ ^[0-9a-f]{40}$',
	'packager must require a full lowercase Git SHA'
);
requireText(
	packager,
	`if [[ "\${TARGET_ENVIRONMENT:-}" != 'staging' ]]`,
	'packager must remain staging-only'
);
for (const requiredFile of [
	'build/200.html',
	'build/_headers',
	'build/manifest.webmanifest',
	'build/registerSW.js',
	'build/sw.js',
	'tools/checks/check-deployed-site.mjs',
	'tools/checks/check-deployment-artifact.mjs',
	'tools/checks/deployment-contract.mjs',
	'tools/checks/validate-pages-deploy-output.mjs'
]) {
	requireText(packager, requiredFile, `packager must require ${requiredFile}`);
}
requireText(packager, "echo 'schema_version=2'", 'packager must emit the reviewed manifest schema');
requireText(
	packager,
	"echo 'target_environment=staging'",
	'packager manifest must remain staging-only'
);
requireText(
	packager,
	'find . -type l -print -quit | grep -q .',
	'packager must reject symbolic links before checksumming'
);
requireText(
	packager,
	'find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS',
	'packager must checksum every packaged file deterministically'
);
requireText(packager, 'sha256sum -c SHA256SUMS', 'packager must verify generated checksums');

for (const forbiddenSecret of [
	'GEMINI_API_KEY',
	'SUPABASE_SERVICE_ROLE_KEY',
	'GOOGLE_CLIENT_SECRET',
	'DRIVE_REFRESH_TOKEN',
	'OCR_WORKER_DEVICE_TOKEN',
	'CLOUDFLARE_API_TOKEN'
]) {
	forbidText(
		source,
		forbiddenSecret,
		`artifact build workflow must not receive backend/deployment secret ${forbiddenSecret}`
	);
}
for (const forbiddenProductionText of [
	'production-deploy',
	'PRODUCTION_ARTIFACT_BUILD_ENABLED',
	'options:\n          - staging\n          - production',
	'environment: production'
]) {
	forbidText(
		source,
		forbiddenProductionText,
		`staging artifact workflow must not reference unprovisioned production state: ${forbiddenProductionText}`
	);
}

if (failures.length > 0) {
	console.error(`Deployment artifact workflow checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Deployment artifact workflow checks passed.');
}
