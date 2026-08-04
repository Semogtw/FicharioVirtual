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
	expect(source).toContain(
		"import { runBrowserExclusive } from '$lib/import/browser-exclusive';"
	);
	expect(source).toContain(
		"return runBrowserExclusive(`fichario-import-${item.resumeKey}`, operation);"
	);
	expect(source).not.toContain('type LockManagerLike');
	expect(source).not.toContain('navigator as Navigator & { locks?:');
}

describe('import queue cross-tab exclusion', () => {
	it('uses the shared browser coordinator for image imports', () => {
		expectSharedExclusion(imageQueue);
	});

	it('uses the shared browser coordinator for PDF imports', () => {
		expectSharedExclusion(pdfQueue);
	});
});
