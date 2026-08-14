import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repositoryRoot), 'utf8');

describe('Supabase local configuration', () => {
	it('uses the current local SMTP section', () => {
		const config = read('supabase/config.toml');
		expect(config).toContain('[local_smtp]');
		expect(config).not.toContain('[inbucket]');
		expect(config).toMatch(/\[local_smtp\][\s\S]*?enabled\s*=\s*true/);
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

	it('allows only explicit non-JWT service endpoints through the gateway', () => {
		const config = read('supabase/config.toml');
		const entries = [...config.matchAll(/\[functions\.([^\]]+)\]\s+verify_jwt\s*=\s*false/g)].map(
			(entry) => entry[1]
		);
		expect([...entries].sort()).toEqual(
			[
				'ocr-queue-worker',
				'semantic-index-worker',
				'semantic-visual-worker',
				'drive-oauth-callback',
				'desktop-ocr-pair',
				'desktop-ocr-worker'
			].sort()
		);
	});

	it('keeps the public desktop pairing gateway redeem-only and service bounded', () => {
		const source = read('supabase/functions/desktop-ocr-pair/index.ts');
		expect(source).toContain("admin.rpc('redeem_ocr_worker_pairing_code'");
		expect(source).toContain("record.action !== 'redeem'");
		expect(source).not.toContain("request.headers.get('Authorization')");
		expect(source).not.toContain("if (input.action === 'revoke')");
		expect(source).not.toContain('userClient.auth.getUser()');
	});
});
