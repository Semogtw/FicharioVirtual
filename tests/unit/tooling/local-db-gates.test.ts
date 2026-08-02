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
		expect(packageJson.scripts?.['test:db:local']).toBe(
			'bash tools/checks/run-local-db-gates.sh'
		);
		expect(packageJson.scripts?.['test:functions:check']).toBe(
			'bash tools/checks/check-edge-functions.sh'
		);
		expect(packageJson.scripts?.['verify:full']).toBe(
			'pnpm verify && pnpm test:e2e && pnpm test:source:offline && pnpm test:functions:check && pnpm test:db:local'
		);
	});

	it('runs every local database contract after rebuilding the schema', () => {
		const runner = read('tools/checks/run-local-db-gates.sh');

		expect(runner).toContain('supabase start');
		expect(runner).toContain('supabase db reset');
		expect(runner).toContain('supabase test db');
		expect(runner).toContain('tools/checks/test-ocr-claim-concurrency.sh');
		expect(runner).toContain('tools/checks/test-ocr-idempotency.sh');
	});

	it('checks every deployed Edge Function and shared OCR module with Deno', () => {
		const runner = read('tools/checks/check-edge-functions.sh');

		for (const path of [
			'supabase/functions/_shared/cors.ts',
			'supabase/functions/_shared/ocr-contract.ts',
			'supabase/functions/_shared/gemini-ocr-client.ts',
			'supabase/functions/process-ocr/index.ts',
			'supabase/functions/delete-document/index.ts'
		]) {
			expect(runner).toContain(`deno check ${path}`);
		}
	});

	it('keeps provider and CORS boundaries in the dependency-free source gate', () => {
		const sourceGate = read('tools/checks/check-source-security.mjs');

		expect(sourceGate).toContain('supabase/functions/process-ocr/index.ts');
		expect(sourceGate).toContain('supabase/functions/delete-document/index.ts');
		expect(sourceGate).toContain('edge-cors');
		expect(sourceGate).toContain('provider-duplication');
	});
});
