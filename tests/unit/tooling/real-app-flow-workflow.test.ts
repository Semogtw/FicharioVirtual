import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('.github/workflows/verify-real-app-flows.yml', 'utf8');

describe('real deployed app flow workflow', () => {
	it('runs only after a successful production deployment or explicit recovery', () => {
		expect(source).toContain('workflows: [Deploy validated Fichário artifact to Cloudflare Pages]');
		expect(source).toContain("github.event.workflow_run.conclusion == 'success'");
		expect(source).toContain("github.event.workflow_run.head_branch == 'main'");
		expect(source).toContain('workflow_dispatch:');
		expect(source).toContain('TARGET_URL: https://fichario-virtual.pages.dev');
	});

	it('serializes use of the shared protected staging account', () => {
		expect(source).toContain('group: staging-contract-verification');
		expect(source).toContain('cancel-in-progress: false');
	});

	it('uses protected real credentials without checking out the repository', () => {
		expect(source).toContain('environment: staging');
		expect(source).toContain('STAGING_AUTHORIZED_EMAIL: ${{ secrets.STAGING_AUTHORIZED_EMAIL }}');
		expect(source).toContain(
			'STAGING_AUTHORIZED_PASSWORD: ${{ secrets.STAGING_AUTHORIZED_PASSWORD }}'
		);
		expect(source).toContain('STAGING_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}');
		expect(source).toContain(
			'STAGING_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.STAGING_SUPABASE_PUBLISHABLE_KEY }}'
		);
		expect(source).not.toContain('actions/checkout@');
	});

	it('fetches the exact deployed SHA and uses pinned browser dependencies', () => {
		expect(source).toContain('raw.githubusercontent.com/Semogtw/FicharioVirtual/${TARGET_SHA}');
		expect(source).toContain('playwright@1.62.1');
		expect(source).toContain('@supabase/supabase-js@2.57.4');
		expect(source).toContain('pdf-lib@1.17.1');
		expect(source).toContain('npx playwright install --with-deps chromium');
		expect(source).toContain('node check-real-app-flows.mjs');
	});
});
