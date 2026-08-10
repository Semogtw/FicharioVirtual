import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('Supabase staging verification workflow', () => {
	it('is reusable after deploy while keeping manual recovery', () => {
		const workflow = read('.github/workflows/verify-supabase-staging.yml');

		expect(workflow).toContain('workflow_call:');
		expect(workflow).toContain('target_sha:');
		expect(workflow).toContain('workflow_dispatch:');
		expect(workflow).toContain(
			"ref: ${{ inputs.target_sha != '' && inputs.target_sha || github.sha }}"
		);
		expect(workflow).toContain('environment: staging');
	});

	it('uses a protected staging environment and public client credentials only', () => {
		const workflow = read('.github/workflows/verify-supabase-staging.yml');

		expect(workflow).toContain('STAGING_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}');
		expect(workflow).toContain(
			'STAGING_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.STAGING_SUPABASE_PUBLISHABLE_KEY }}'
		);
		expect(workflow).toContain('STAGING_AUTHORIZED_EMAIL: ${{ secrets.STAGING_AUTHORIZED_EMAIL }}');
		expect(workflow).toContain(
			'STAGING_UNAUTHORIZED_EMAIL: ${{ secrets.STAGING_UNAUTHORIZED_EMAIL }}'
		);
		expect(workflow.toLowerCase()).not.toContain('service_role');
	});

	it('installs from the lockfile and runs both public-credential verifiers', () => {
		const workflow = read('.github/workflows/verify-supabase-staging.yml');

		expect(workflow).toContain('contents: read');
		expect(workflow).toContain('persist-credentials: false');
		expect(workflow).toContain('version: 10');
		expect(workflow).toContain('node-version: 22.16.0');
		expect(workflow).toContain('cache-dependency-path: pnpm-lock.yaml');
		expect(workflow).toContain('pnpm install --frozen-lockfile');
		expect(workflow).toContain('name: Verify Auth, RLS, and private Storage');
		expect(workflow).toContain('pnpm test:staging:supabase');
		expect(workflow).toContain('name: Verify desktop OCR one-time pairing');
		expect(workflow).toContain('pnpm test:staging:desktop-ocr-pairing');
	});

	it('keeps the pairing probe on public credentials without service-role material', () => {
		const script = read('tools/checks/check-desktop-ocr-pairing-staging.mjs');
		const packageJson = read('package.json');

		expect(script).toContain("apikey: publishableKey");
		expect(script).toContain("'Content-Type': 'application/json'");
		expect(script).not.toContain('Authorization');
		expect(script.toLowerCase()).not.toContain('service_role');
		expect(script).toContain("replayResponse.status !== 409");
		expect(script).toContain("'credential' in redeemed");
		expect(script).toContain("client.rpc('delete_ocr_worker_device'");
		expect(packageJson).toContain('"test:staging:desktop-ocr-pairing"');
	});

	it('serializes the shared staging account with the OCR verifier', () => {
		const workflow = read('.github/workflows/verify-supabase-staging.yml');
		const ocrWorkflow = read('.github/workflows/verify-ocr-staging.yml');

		for (const source of [workflow, ocrWorkflow]) {
			expect(source).toContain('group: staging-contract-verification');
			expect(source).toContain('cancel-in-progress: false');
		}
	});
});
