import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/ImportQueueTray.svelte', 'utf8');

describe('image import cancellation affordance', () => {
	it('keeps cancellation before durable publication and leaves OCR retry to the background worker', () => {
		expect(source).toContain("? ['queued', 'preparing', 'uploading'].includes(entry.item.status)");
		expect(source).toContain('cancelImport(entry.item.id);');
		expect(source).not.toContain("['preparing', 'uploading', 'reading']");
	});
});
