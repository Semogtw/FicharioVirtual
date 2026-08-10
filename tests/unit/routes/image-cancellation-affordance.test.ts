import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../src/lib/components/ImportQueueTray.svelte', import.meta.url),
	'utf8'
);

describe('image import cancellation affordance', () => {
	it('keeps cancellation available until the server owns the OCR work', () => {
		expect(source).toContain("['queued', 'preparing', 'uploading'].includes(entry.item.status)");
		expect(source).toContain("if (entry.kind === 'image') cancelImport(entry.item.id);");
		expect(source).toContain("waiting: 'Leitura em segundo plano'");
	});
});
