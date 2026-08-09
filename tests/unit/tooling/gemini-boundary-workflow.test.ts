import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/verify-gemini-boundary.yml', 'utf8');
const runner = readFileSync('tools/checks/check-gemini-boundary-staging.mjs', 'utf8');

describe('Gemini boundary staging harness', () => {
	it('matches the protected staging environment and existing public secret mappings', () => {
		expect(workflow).toContain('environment: staging');
		expect(workflow).toContain('group: staging-contract-verification');
		expect(workflow).toContain('STAGING_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}');
		expect(workflow).toContain(
			'STAGING_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.STAGING_SUPABASE_PUBLISHABLE_KEY }}'
		);
		expect(workflow).toContain('STAGING_AUTHORIZED_EMAIL: ${{ secrets.STAGING_AUTHORIZED_EMAIL }}');
		expect(workflow).toContain(
			'STAGING_AUTHORIZED_PASSWORD: ${{ secrets.STAGING_AUTHORIZED_PASSWORD }}'
		);
		expect(workflow).toContain('STAGING_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SERVICE_ROLE_KEY }}');
		expect(workflow).not.toMatch(/echo\s+\$\{?STAGING_/);
	});

	it('reports missing configuration without attempting a transport call', () => {
		expect(runner).toContain("code: 'configuration_missing'");
		expect(runner).toContain('if (missingEnv(configuration).length > 0)');
		expect(runner).toContain('console.log(JSON.stringify(report))');
		expect(runner).not.toContain('console.log(serviceRoleKey');
	});
});
