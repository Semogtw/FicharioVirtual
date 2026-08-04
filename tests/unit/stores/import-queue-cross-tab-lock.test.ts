import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);
const imageQueue = readFileSync(
	new URL('src/lib/stores/import-queue.svelte.ts', repositoryRoot),
	'utf8'
);
const pdfQueue = readFileSync(
	new URL('src/lib/stores/pdf-import-queue.svelte.ts', repositoryRoot),
	'utf8'
);

function expectSharedExclusion(source: string) {
	expect(source).toContain("import { runBrowserExclusive } from '$lib/import/browser-exclusive';");
	expect(source).toContain(
		'return runBrowserExclusive(`fichario-import-${item.resumeKey}`, operation);'
	);
	expect(source).not.toContain('type LockManagerLike');
	expect(source).not.toContain('navigator as Navigator & { locks?:');
}

describe('import queue cross-tab exclusion', () => {
	it('uses the shared browser coordinator and retries image lock contention', () => {
		expectSharedExclusion(imageQueue);
		expect(imageQueue).toContain('const IMPORT_LOCK_RETRY_MS = 1_000;');
		expect(imageQueue).toContain('const importRetryTimers = new Map<');
		expect(imageQueue).toContain('if (!acquired) scheduleImportRetry(item);');
		expect(imageQueue).toContain('clearImportRetry(item.id);');
	});

	it('uses the shared browser coordinator without a PDF busy loop', () => {
		expectSharedExclusion(pdfQueue);
		expect(pdfQueue).toContain('const IMPORT_LOCK_RETRY_MS = 1_000;');
		expect(pdfQueue).toContain('let lockRetryTimer: ReturnType<typeof setTimeout> | null = null;');
		expect(pdfQueue).toMatch(
			/if \(!acquired\) \{\s*schedulePumpRetry\(\);\s*return;\s*\}/
		);
	});
});
