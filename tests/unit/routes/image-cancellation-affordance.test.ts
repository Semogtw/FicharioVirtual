import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../src/routes/import/+page.svelte', import.meta.url),
	'utf8'
);

describe('image import cancellation affordance', () => {
	it('keeps cancellation available while OCR is running', () => {
		expect(source).toContain("return ['preparing', 'uploading', 'reading'].includes(item.status);");
		expect(source).toContain('onclick={() => cancelImport(item.id)}');
	});
});
