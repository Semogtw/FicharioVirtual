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

function occurrenceCount(source: string, value: string) {
	return source.split(value).length - 1;
}

function expectReactiveQueueAppend(
	source: string,
	queueName: 'importQueue' | 'pdfImportQueue',
	helperName: 'appendImportItem' | 'appendPdfImportItem',
	itemType: 'ImportQueueItem' | 'PdfQueueItem'
) {
	expect(source).toContain(`function ${helperName}(item: ${itemType})`);
	expect(occurrenceCount(source, `${queueName}.items.push(item);`)).toBe(1);
	expect(occurrenceCount(source, `${helperName}(item)`)).toBe(2);
	expect(source).toContain(`const appended = ${queueName}.items[${queueName}.items.length - 1];`);
	expect(source).toContain('return appended;');
}

describe('import queue cross-tab exclusion', () => {
	it('uses the shared browser coordinator and retries image lock contention', () => {
		expectSharedExclusion(imageQueue);
		expect(imageQueue).toContain('const IMPORT_LOCK_RETRY_MS = 1_000;');
		expect(imageQueue).toContain('const importRetryTimers = new Map<');
		expect(imageQueue).toContain('if (!acquired) scheduleImportRetry(item);');
		expect(imageQueue).toContain('clearImportRetry(item.id);');
	});

	it('discards terminal image imports completed in another tab', () => {
		expect(imageQueue).toContain(
			"import {\n\tpublishImportUpdate,\n\tsubscribeImportUpdates,\n\ttype ImportBroadcastUpdate\n} from '$lib/import/import-broadcast';"
		);
		expect(imageQueue).toContain("update.type === 'image-import-updated'");
		expect(imageQueue).toContain('subscribeImportUpdates(handleImportUpdate);');
		expect(imageQueue).toContain("publishImportUpdate({ type: 'image-import-updated'");
		expect(imageQueue).not.toContain('let importChannel: BroadcastChannel | null = null;');
	});

	it('retains remote completion tombstones for each discarded item lifetime', () => {
		for (const [source, itemType] of [
			[imageQueue, 'ImportQueueItem'],
			[pdfQueue, 'PdfQueueItem']
		] as const) {
			expect(source).toContain(`const completedElsewhere = new WeakSet<${itemType}>();`);
			expect(source).toContain('completedElsewhere.add(item);');
			expect(source).toContain('completedElsewhere.has(item)');
			expect(source).not.toContain('completedElsewhere.delete(');
		}
	});

	it('prefers the authoritative remote session found by resume key', () => {
		for (const source of [imageQueue, pdfQueue]) {
			expect(source).toContain('sessionId: remoteSession?.id ?? record.sessionId ?? null,');
			expect(source).not.toContain('sessionId: record.sessionId ?? remoteSession?.id ?? null,');
		}
	});

	it('continues queue work through the proxied item returned by Svelte state', () => {
		expectReactiveQueueAppend(imageQueue, 'importQueue', 'appendImportItem', 'ImportQueueItem');
		expectReactiveQueueAppend(pdfQueue, 'pdfImportQueue', 'appendPdfImportItem', 'PdfQueueItem');
	});

	it('uses the shared browser coordinator without a PDF busy loop', () => {
		expectSharedExclusion(pdfQueue);
		expect(pdfQueue).toContain('const IMPORT_LOCK_RETRY_MS = 1_000;');
		expect(pdfQueue).toContain('let lockRetryTimer: ReturnType<typeof setTimeout> | null = null;');
		expect(pdfQueue).toMatch(/if \(!acquired\) \{\s*schedulePumpRetry\(\);\s*return;\s*\}/);
	});
});
