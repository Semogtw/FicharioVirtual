import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('local database gate runner', () => {
	it('exposes the database and full verification commands through pnpm', () => {
		const packageJson = JSON.parse(read('package.json')) as {
			scripts?: Record<string, string>;
		};

		expect(packageJson.scripts?.['test:source:offline']).toBe(
			'bash tools/checks/run-offline-source-gates.sh'
		);
		expect(packageJson.scripts?.['test:db:local']).toBe('bash tools/checks/run-local-db-gates.sh');
		expect(packageJson.scripts?.['test:functions:check']).toBe(
			'bash tools/checks/check-edge-functions.sh'
		);
		expect(packageJson.scripts?.['verify:full']).toBe(
			'pnpm verify && pnpm test:e2e && pnpm test:source:offline && pnpm test:functions:check && pnpm test:db:local'
		);
	});

	it('runs every local database contract after rebuilding the schema', () => {
		const runner = read('tools/checks/run-local-db-gates.sh');
		const fixture = read('tools/checks/fixtures/ocr-concurrency-fixture.sql');
		const concurrencyGate = read('tools/checks/test-ocr-claim-concurrency.sh');

		expect(runner).toContain('supabase start');
		expect(runner).toContain('supabase db reset');
		expect(runner).toContain('supabase test db');
		expect(runner).toContain('tools/checks/test-ocr-claim-concurrency.sh');
		expect(runner).toContain('tools/checks/test-ocr-idempotency.sh');
		expect(fixture).toContain('insert into public.ocr_jobs');
		expect(fixture).toContain('ocr_consent_version');
		expect(concurrencyGate).toContain('parse_claim_state');
		expect(concurrencyGate).not.toMatch(/\bpython(?:3)?\b/);
	});

	it('checks every deployed Edge Function and shared OCR module with isolated Deno config', () => {
		const runner = read('tools/checks/check-edge-functions.sh');

		for (const path of [
			'supabase/functions/_shared/cors.ts',
			'supabase/functions/_shared/ocr-contract.ts',
			'supabase/functions/_shared/gemini-ocr-client.ts',
			'supabase/functions/_shared/ocr-failure.ts',
			'supabase/functions/process-ocr/index.ts',
			'supabase/functions/delete-document/index.ts'
		]) {
			expect(runner).toContain(`deno check --no-config ${path}`);
		}
	});

	it('keeps provider, CORS and RPC typing boundaries in the dependency-free source gate', () => {
		const sourceGate = read('tools/checks/check-source-security.mjs');
		const runner = read('tools/checks/run-offline-source-gates.sh');

		expect(sourceGate).toContain('supabase/functions/process-ocr/index.ts');
		expect(sourceGate).toContain('supabase/functions/delete-document/index.ts');
		expect(sourceGate).toContain('edge-cors');
		expect(sourceGate).toContain('provider-duplication');
		expect(sourceGate).toContain('provider-test-surface');
		expect(sourceGate).toContain('GEMINI_API_URL');
		expect(sourceGate).toContain('OCR_PROVIDER_URL');
		expect(sourceGate).toContain('X-FICHARIO-FAULT');
		expect(runner).toContain('node tools/checks/check-rpc-types.mjs');
	});
});
