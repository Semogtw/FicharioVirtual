import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = '.github/workflows/deploy-supabase-staging.yml';
const source = readFileSync(path, 'utf8');

describe('Supabase staging migration deploy workflow', () => {
	it('is manual, protected and cannot push repository contents', () => {
		expect(source).toContain('workflow_dispatch:');
		expect(source).toContain('environment: staging-deploy');
		expect(source).toMatch(/permissions:\s*\n\s*contents:\s*read/);
		expect(source).not.toMatch(/^\s*contents:\s*write\s*$/m);
		expect(source).toContain('persist-credentials: false');
	});

	it('pins the same Supabase CLI family used by current-head validation', () => {
		expect(source).toContain('uses: supabase/setup-cli@v2');
		expect(source).toContain('version: 2.111.0');
	});

	it('previews pending migrations before applying the linked history in order', () => {
		const before = source.indexOf('supabase migration list --linked');
		const dryRun = source.indexOf('supabase db push --linked --dry-run');
		const push = source.indexOf('supabase db push --linked\n');
		const after = source.lastIndexOf('supabase migration list --linked');

		expect(before).toBeGreaterThan(-1);
		expect(dryRun).toBeGreaterThan(before);
		expect(push).toBeGreaterThan(dryRun);
		expect(after).toBeGreaterThan(push);
		expect(source).not.toContain('--include-all');
	});

	it('takes administrative connection material only from protected environment settings', () => {
		expect(source).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.STAGING_SUPABASE_ACCESS_TOKEN }}');
		expect(source).toContain('SUPABASE_DB_PASSWORD: ${{ secrets.STAGING_SUPABASE_DB_PASSWORD }}');
		expect(source).toContain('STAGING_SUPABASE_PROJECT_REF: ${{ vars.STAGING_SUPABASE_PROJECT_REF }}');
		expect(source).not.toContain('exgggshcdzjaxmfcoasm');
	});
});
