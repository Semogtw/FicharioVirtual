import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/build-deployment-artifact.yml', 'utf8');
const packager = readFileSync('tools/deploy/package-static-artifact.sh', 'utf8');
const workflowChecker = readFileSync('tools/checks/check-deployment-artifact-workflow.mjs', 'utf8');

describe('deployable static artifact workflow', () => {
	it('remains manual, staging-only, read-only, and exact-SHA gated', () => {
		expect(workflow).toContain('on:\n  workflow_dispatch:');
		expect(workflow).not.toContain('\n  push:');
		expect(workflow).not.toContain('\n  pull_request:');
		expect(workflow).not.toContain('\n  schedule:');
		expect(workflow).toContain('permissions:\n  actions: read\n  contents: read');
		expect(workflow).toContain('environment: staging');
		expect(workflow).toContain('TARGET_ENVIRONMENT: staging');
		expect(workflow).toContain(
			'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803'
		);
		expect(workflow).toContain('persist-credentials: false');
		expect(workflow).toContain('- name: Require green current-head validation for this SHA');
		expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
		expect(workflow).toContain('/git/ref/heads/main');
		expect(workflow).toContain('if [[ "$main_sha" != "$GITHUB_SHA" ]]');
		expect(workflow).toContain(
			'/actions/workflows/validate-current-head.yml/runs?head_sha=${GITHUB_SHA}'
		);
		expect(workflow).toContain('.head_branch == \\"main\\"');
		expect(workflow).toContain('.event == \\"push\\"');
		expect(workflow).toContain('.conclusion == \\"success\\"');
		expect(workflow).toContain('No successful Validate current head push run exists');
	});

	it('uses reviewed pinned actions and the committed lockfile', () => {
		expect(workflow).toContain(
			'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86'
		);
		expect(workflow).toContain(
			'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38'
		);
		expect(workflow).toContain('pnpm install --frozen-lockfile');
		expect(workflow).toContain(
			'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
		);
	});

	it('builds only from staging public configuration and rejects local config leakage', () => {
		expect(workflow).toContain('PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}');
		expect(workflow).toContain(
			'PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.PUBLIC_SUPABASE_PUBLISHABLE_KEY }}'
		);
		expect(workflow).toContain('PUBLIC_GOOGLE_CLIENT_ID: ${{ secrets.PUBLIC_GOOGLE_CLIENT_ID }}');
		expect(workflow).toContain(
			'PUBLIC_GOOGLE_PICKER_API_KEY: ${{ secrets.PUBLIC_GOOGLE_PICKER_API_KEY }}'
		);
		expect(workflow).toContain(
			'PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: ${{ secrets.PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER }}'
		);
		expect(workflow).toContain('Google Picker public settings must be configured together');
		expect(workflow).toContain('run: pnpm verify');
		expect(workflow).toContain("! grep -R -F '127.0.0.1:54321' build");
		expect(workflow).toContain("! grep -R -F 'sb_publishable_test_key_1234567890' build");
	});

	it('packages and verifies one immutable staging artifact before upload', () => {
		expect(workflow).toContain(
			'run: bash tools/deploy/package-static-artifact.sh fichario-deploy'
		);
		expect(workflow).toContain('run: pnpm test:deployment:artifact -- fichario-deploy');
		expect(workflow).toContain('name: fichario-static-${{ github.sha }}-staging');
		expect(workflow).toContain('if-no-files-found: error');
		expect(packager).toContain('set -euo pipefail');
		expect(packager).toContain("echo 'schema_version=2'");
		expect(packager).toContain("echo 'target_environment=staging'");
		expect(packager).toContain('sha256sum -c SHA256SUMS');
		expect(workflowChecker).toContain('artifact build workflow must remain manual-only');
	});

	it('never receives backend/deployment secrets or performs deployment mutations', () => {
		for (const forbidden of [
			'GEMINI_API_KEY',
			'SUPABASE_SERVICE_ROLE_KEY',
			'GOOGLE_CLIENT_SECRET',
			'DRIVE_REFRESH_TOKEN',
			'OCR_WORKER_DEVICE_TOKEN',
			'CLOUDFLARE_API_TOKEN'
		]) {
			expect(workflow).not.toContain(forbidden);
		}
		expect(workflow).not.toContain('production-deploy');
		expect(workflow).not.toContain('PRODUCTION_ARTIFACT_BUILD_ENABLED');
		expect(workflow).not.toContain('wrangler pages deploy');
		expect(workflow).not.toContain('supabase db push');
		expect(workflow).not.toContain('supabase functions deploy');
	});
});
