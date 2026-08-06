import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('Supabase local configuration', () => {
	it('uses the current local SMTP section', () => {
		const config = read('supabase/config.toml');

		expect(config).toContain('[local_smtp]');
		expect(config).not.toContain('[inbucket]');
		expect(config).toMatch(/\[local_smtp\][\s\S]*?enabled\s*=\s*true/);
		expect(config).toMatch(/\[local_smtp\][\s\S]*?port\s*=\s*54324/);
	});

	it('requires JWT for authenticated application Edge Functions', () => {
		const config = read('supabase/config.toml');

		for (const functionName of [
			'process-ocr',
			'delete-document',
			'drive-oauth-start',
			'drive-access-token',
			'drive-resolve-folder',
			'drive-run-jobs',
			'drive-sync'
		]) {
			expect(config).toMatch(
				new RegExp(`\\[functions\\.${functionName}\\]\\s+verify_jwt\\s*=\\s*true`)
			);
		}
	});

	it('allows only the Google OAuth callback through the gateway without a Supabase JWT', () => {
		const config = read('supabase/config.toml');

		expect(config).toMatch(/\[functions\.drive-oauth-callback\]\s+verify_jwt\s*=\s*false/);
		const disabledJwtEntries = [
			...config.matchAll(/\[functions\.([^\]]+)\]\s+verify_jwt\s*=\s*false/g)
		];
		expect(disabledJwtEntries.map((entry) => entry[1])).toEqual(['drive-oauth-callback']);
	});
});
