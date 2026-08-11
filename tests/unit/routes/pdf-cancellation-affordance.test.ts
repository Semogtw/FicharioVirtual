import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/ImportQueueTray.svelte', 'utf8');

describe('PDF cancellation affordance', () => {
	it('keeps cancellation through publication but does not cancel durable background OCR', () => {
		expect(source).toContain(
			": ['queued', 'inspecting', 'uploading', 'rendering', 'publishing'].includes("
		);
		expect(source).toContain('cancelPdfImport(entry.item.id);');
		expect(source).not.toContain("'publishing', 'reading'");
	});
});
