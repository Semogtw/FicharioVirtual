import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runnerSource = readFileSync('src/lib/components/NativeSyncOnceRunner.svelte', 'utf8');

describe('native sync-once runner', () => {
	it('is mounted outside the authenticated shell so an expired session can still exit', () => {
		expect(readFileSync('src/routes/+layout.svelte', 'utf8')).toContain('<NativeSyncOnceRunner />');
		expect(runnerSource).toContain('getNativeSyncOnceMode()');
		expect(runnerSource).toContain('finishNativeSyncOnce()');
	});

	it('bounds the one-shot worker before requesting controlled exit', () => {
		expect(runnerSource).toContain('NATIVE_SYNC_ONCE_TIMEOUT_MS');
		expect(runnerSource).toContain('runNativeSyncWorker().catch(() => undefined)');
	});
});
