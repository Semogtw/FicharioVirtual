import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('.github/workflows/verify-staging-artifact-config.yml', 'utf8');

describe('staging artifact public configuration workflow', () => {
	it('runs after a green current-head validation and remains manually recoverable', () => {
		expect(source).toContain('workflow_run:');
		expect(source).toContain('workflows: [Validate current head]');
		expect(source).toContain('types: [completed]');
		expect(source).toContain("github.event.workflow_run.conclusion == 'success'");
		expect(source).toContain("github.event.workflow_run.head_branch == 'main'");
		expect(source).toContain('workflow_dispatch:');
	});

	it('uses only the protected staging public values required by the static artifact', () => {
		expect(source).toContain('environment: staging');
		expect(source).toContain('PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}');
		expect(source).toContain(
			'PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.PUBLIC_SUPABASE_PUBLISHABLE_KEY }}'
		);
		expect(source).toContain('PUBLIC_GOOGLE_CLIENT_ID: ${{ secrets.PUBLIC_GOOGLE_CLIENT_ID }}');
		expect(source).toContain(
			'PUBLIC_GOOGLE_PICKER_API_KEY: ${{ secrets.PUBLIC_GOOGLE_PICKER_API_KEY }}'
		);
		expect(source).toContain(
			'PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: ${{ secrets.PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER }}'
		);
		expect(source).not.toContain('STAGING_SERVICE_ROLE_KEY');
		expect(source).not.toContain('GEMINI_API_KEY');
		expect(source).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(source).not.toContain('CLOUDFLARE_ACCOUNT_ID');
	});

	it('fails closed on missing/invalid Supabase config and partial Google Picker config', () => {
		expect(source).toContain('PUBLIC_SUPABASE_URL is not configured in staging.');
		expect(source).toContain('PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured in staging.');
		expect(source).toContain('PUBLIC_SUPABASE_URL must be a credential-free HTTPS origin.');
		expect(source).toContain('PUBLIC_SUPABASE_PUBLISHABLE_KEY is invalid.');
		expect(source).toContain('Google Picker public settings must be configured together.');
		expect(source).toContain('PUBLIC_GOOGLE_CLIENT_ID is invalid.');
		expect(source).toContain('PUBLIC_GOOGLE_PICKER_API_KEY is invalid.');
		expect(source).toContain('PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER is invalid.');
	});

	it('keeps repository permissions read-only and never prints secret values', () => {
		expect(source).toMatch(/permissions:\s*\n\s*contents:\s*read/);
		expect(source).not.toMatch(/^\s*contents:\s*write\s*$/m);
		expect(source).not.toContain('echo "$PUBLIC_');
		expect(source).toContain('without printing values');
	});
});
