import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);
const queueTray = readFileSync(
	new URL('src/lib/components/ImportQueueTray.svelte', repositoryRoot),
	'utf8'
);

describe('import queue background OCR reconciliation', () => {
	it('reacts when an already-mounted queue later enters the waiting state', () => {
		expect(queueTray).toContain('$effect(() => {');
		expect(queueTray).toContain('const hasWaitingOcr = entries.some(');
		expect(queueTray).toContain(
			"(entry) => entry.item.status === 'waiting' && entry.item.result !== null"
		);
		expect(queueTray).toContain('if (pollTimer === null && !refreshing)');
		expect(queueTray).toContain('void refreshBackgroundOcr().finally(scheduleBackgroundPoll);');
	});
});
