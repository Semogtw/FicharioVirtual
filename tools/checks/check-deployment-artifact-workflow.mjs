import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const workflowPath = resolve(root, '.github/workflows/build-deployment-artifact.yml');
const source = await readFile(workflowPath, 'utf8');
const failures = [];

function requireText(text, detail) {
	if (!source.includes(text)) failures.push(detail);
}

function forbidText(text, detail) {
	if (source.includes(text)) failures.push(detail);
}

requireText('on:\n  workflow_dispatch:', 'artifact build workflow must remain manual-only');
forbidText('\n  push:', 'artifact build workflow must not run on push');
forbidText('\n  pull_request:', 'artifact build workflow must not run on pull requests');
forbidText('\n  schedule:', 'artifact build workflow must not run on a schedule');
requireText(
	'permissions:\n  contents: read',
	'artifact build workflow permissions must remain contents:read'
);
requireText(
	'environment: ${{ inputs.target_environment }}',
	'artifact build must use the selected protected configuration environment'
);
requireText(
	'PRODUCTION_ARTIFACT_BUILD_ENABLED: ${{ vars.PRODUCTION_ARTIFACT_BUILD_ENABLED }}',
	'production artifact creation must require an explicit environment flag'
);
requireText(
	`if [[ "$TARGET_ENVIRONMENT" == 'production' && "$PRODUCTION_ARTIFACT_BUILD_ENABLED" != 'true' ]]; then`,
	'production artifact creation must fail closed until explicitly enabled'
);
requireText(
	'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
	'checkout action must remain pinned to the reviewed commit'
);
requireText(
	'persist-credentials: false',
	'artifact checkout must not persist repository credentials'
);
requireText(
	'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
	'pnpm setup action must remain pinned to the reviewed commit'
);
requireText(
	'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
	'Node setup action must remain pinned to the reviewed commit'
);
requireText(
	'pnpm install --frozen-lockfile',
	'artifact build must install only from the committed lockfile'
);
requireText(
	'PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}',
	'artifact build must obtain the public Supabase URL from the protected environment'
);
requireText(
	'PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.PUBLIC_SUPABASE_PUBLISHABLE_KEY }}',
	'artifact build must obtain the publishable Supabase key from the protected environment'
);
requireText(
	'PUBLIC_GOOGLE_CLIENT_ID: ${{ secrets.PUBLIC_GOOGLE_CLIENT_ID }}',
	'artifact build must keep Google Picker client ID environment-scoped'
);
requireText(
	'PUBLIC_GOOGLE_PICKER_API_KEY: ${{ secrets.PUBLIC_GOOGLE_PICKER_API_KEY }}',
	'artifact build must keep Google Picker API key environment-scoped'
);
requireText(
	'PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: ${{ secrets.PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER }}',
	'artifact build must keep Google Picker project number environment-scoped'
);
requireText(
	'Google Picker public settings must be configured together',
	'Google Picker public settings must remain all-or-none'
);
requireText('run: pnpm verify', 'artifact build must execute the full repository verify command');
requireText(
	`! grep -R -F '127.0.0.1:54321' build`,
	'artifact build must reject the local Supabase URL'
);
requireText(
	`! grep -R -F 'sb_publishable_test_key_1234567890' build`,
	'artifact build must reject the development publishable key'
);
requireText(
	'mkdir -p fichario-deploy/site fichario-deploy/source fichario-deploy/checks',
	'artifact package must keep public site, source identity and checks separate'
);
requireText(
	'cp tools/checks/check-deployed-site.mjs tools/checks/deployment-contract.mjs fichario-deploy/checks/',
	'artifact must carry the exact post-deployment checker and contract'
);
requireText("echo 'schema_version=2'", 'artifact manifest schema must remain explicit');
requireText(
	'find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS',
	'artifact must checksum every packaged file deterministically'
);
requireText('sha256sum -c SHA256SUMS', 'artifact checksums must be verified before upload');
requireText(
	'run: pnpm test:deployment:artifact -- fichario-deploy',
	'artifact contract must pass before upload'
);
requireText(
	'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
	'artifact upload action must remain pinned to the reviewed commit'
);
requireText(
	'name: fichario-static-${{ github.sha }}-${{ inputs.target_environment }}',
	'artifact identity must bind source SHA and target environment'
);
requireText('if-no-files-found: error', 'missing deployment artifact must fail the workflow');

for (const forbiddenSecret of [
	'GEMINI_API_KEY',
	'SUPABASE_SERVICE_ROLE_KEY',
	'GOOGLE_CLIENT_SECRET',
	'DRIVE_REFRESH_TOKEN',
	'OCR_WORKER_DEVICE_TOKEN',
	'CLOUDFLARE_API_TOKEN'
]) {
	forbidText(
		forbiddenSecret,
		`artifact build workflow must not receive backend/deployment secret ${forbiddenSecret}`
	);
}

if (failures.length > 0) {
	console.error(`Deployment artifact workflow checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Deployment artifact workflow checks passed.');
}
