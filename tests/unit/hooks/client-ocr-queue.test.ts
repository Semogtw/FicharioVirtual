import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);
const hook = readFileSync(new URL('src/hooks.client.ts', repositoryRoot), 'utf8');
const session = readFileSync(new URL('src/lib/stores/session.svelte.ts', repositoryRoot), 'utf8');

describe('client OCR queue lifecycle', () => {
	it('restores imports and controls the server-backed queue through authorization lifecycle', () => {
		expect(hook).toContain(
			"import { createOcrQueueLifecycle } from '$lib/import/job-runner-lifecycle';"
		);
		expect(hook).toContain(
			"import { kickOcrQueueBestEffort } from '$lib/services/ocr-background';"
		);
		expect(hook).toContain(
			"import { restoreImageImports } from '$lib/stores/import-queue.svelte';"
		);
		expect(hook).toContain(
			"import { restorePdfImports } from '$lib/stores/pdf-import-queue.svelte';"
		);
		expect(hook).toContain('subscribeSessionAuthorization((authorized) => {');
		expect(hook).toContain(
			'const ocrQueueLifecycle = createOcrQueueLifecycle(() => kickOcrQueueBestEffort());'
		);
		expect(hook).toContain('if (authorized) ocrQueueLifecycle.start();');
		expect(hook).toContain('else ocrQueueLifecycle.stop();');
		expect(hook).toContain('void restoreImageImports(sessionState.user.id);');
		expect(hook).toContain('void restorePdfImports(sessionState.user.id);');
		expect(hook).not.toContain('pauseQueue();');
		expect(hook).not.toContain('resumeQueue();');
		expect(session).toContain('export function subscribeSessionAuthorization(');
	});
});
