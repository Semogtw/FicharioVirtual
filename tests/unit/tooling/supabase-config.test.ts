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
			'ocr-queue-kick',
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

		expect(config).toMatch(/\[functions\.ocr-queue-worker\]\s+verify_jwt\s*=\s*false/);
		expect(config).toMatch(/\[functions\.drive-oauth-callback\]\s+verify_jwt\s*=\s*false/);
		expect(config).toMatch(/\[functions\.desktop-ocr-pair\]\s+verify_jwt\s*=\s*false/);
		const disabledJwtEntries = [
			...config.matchAll(/\[functions\.([^\]]+)\]\s+verify_jwt\s*=\s*false/g)
		];
		expect(disabledJwtEntries.map((entry) => entry[1])).toEqual([
			'ocr-queue-worker',
			'drive-oauth-callback',
			'desktop-ocr-pair',
			'desktop-ocr-worker'
		]);
	});

	it('keeps dedicated authentication inside the public background OCR worker gateway', () => {
		const source = read('supabase/functions/ocr-queue-worker/index.ts');

		expect(source).toContain("Deno.env.get('OCR_BACKGROUND_WORKER_KEY')");
		expect(source).toContain("request.headers.get('X-Fichario-Worker-Key')");
		expect(source).toContain('secretMatches(');
	});

	it('keeps manual auth boundaries inside the public desktop pairing gateway', () => {
		const source = read('supabase/functions/desktop-ocr-pair/index.ts');
		const redeemBoundary = source.indexOf("if (input.action === 'redeem')");
		const browserAuthorization = source.indexOf("request.headers.get('Authorization')");

		expect(redeemBoundary).toBeGreaterThanOrEqual(0);
		expect(browserAuthorization).toBeGreaterThan(redeemBoundary);
		expect(source).toContain("admin.rpc('redeem_ocr_worker_pairing_code'");
		expect(source).toContain('userClient.auth.getUser()');
		expect(source).toContain("if (input.action === 'revoke')");
	});
});
