import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gatePath = 'tools/checks/check-source-security.mjs';

describe('Drive Edge Function security coverage', () => {
	it('checks every browser-facing Drive function with the shared fail-closed CORS policy', () => {
		const gate = readFileSync(gatePath, 'utf8');

		for (const functionName of [
			'drive-oauth-start',
			'drive-access-token',
			'drive-resolve-folder',
			'drive-run-jobs',
			'drive-sync'
		]) {
			expect(gate).toContain(`supabase/functions/${functionName}/index.ts`);
		}
	});

	it('checks the OAuth callback redirect boundary separately from CORS APIs', () => {
		const gate = readFileSync(gatePath, 'utf8');

		expect(gate).toContain('supabase/functions/drive-oauth-callback/index.ts');
		expect(gate).toContain("'oauth-callback-origin'");
		expect(gate).toContain("'oauth-callback-redirect'");
		expect(gate).toContain("'oauth-callback-cache'");
		expect(gate).toContain("'oauth-callback-referrer'");
	});
});
