import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/verify-staging-artifact-config.yml', 'utf8');
const checker = readFileSync('tools/checks/check-staging-public-config.mjs', 'utf8');

describe('staging artifact public configuration workflow', () => {
	it('runs after a green current-head validation and remains manually recoverable', () => {
		expect(workflow).toContain('workflow_run:');
		expect(workflow).toContain('workflows: [Validate current head]');
		expect(workflow).toContain('types: [completed]');
		expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
		expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
		expect(workflow).toContain('workflow_dispatch:');
	});

	it('checks out the exact repository checker with read-only credentials', () => {
		expect(workflow).toContain(
			'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6'
		);
		expect(workflow).toContain('persist-credentials: false');
		expect(workflow).toContain('run: node tools/checks/check-staging-public-config.mjs');
	});

	it('uses only the protected staging public values required by the static artifact', () => {
		expect(workflow).toContain('environment: staging');
		expect(workflow).toContain('TARGET_ENVIRONMENT: staging');
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
		expect(workflow).not.toContain('STAGING_SERVICE_ROLE_KEY');
		expect(workflow).not.toContain('GEMINI_API_KEY');
		expect(workflow).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(workflow).not.toContain('CLOUDFLARE_ACCOUNT_ID');
	});

	it('fails closed when any core release public setting is missing or invalid', () => {
		for (const name of [
			'PUBLIC_SUPABASE_URL',
			'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
			'PUBLIC_GOOGLE_CLIENT_ID',
			'PUBLIC_GOOGLE_PICKER_API_KEY',
			'PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER'
		]) {
			expect(checker).toContain(`${name} is not configured in staging.`);
		}
		expect(checker).toContain(
			'TARGET_ENVIRONMENT must remain staging until production infrastructure exists.'
		);
		expect(checker).toContain('PUBLIC_SUPABASE_URL must be a credential-free HTTPS origin.');
		expect(checker).toContain('PUBLIC_SUPABASE_PUBLISHABLE_KEY is invalid.');
		expect(checker).toContain('PUBLIC_GOOGLE_CLIENT_ID is invalid.');
		expect(checker).toContain('PUBLIC_GOOGLE_PICKER_API_KEY is invalid.');
		expect(checker).toContain('PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER is invalid.');
		expect(workflow).toContain('Google Drive Picker: required for a release artifact');
	});

	it('keeps repository permissions read-only and never prints secret values', () => {
		expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
		expect(workflow).not.toMatch(/^\s*contents:\s*write\s*$/m);
		expect(workflow).not.toContain('echo "$PUBLIC_');
		expect(checker).not.toContain('console.log(urlValue)');
		expect(checker).not.toContain('console.log(publishableKey)');
		expect(workflow).toContain('without printing values');
	});
});
