import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const imageImportSource = readFileSync('src/routes/import/+page.svelte', 'utf8');
const pdfImportSource = readFileSync('src/routes/import/pdf/+page.svelte', 'utf8');

describe('import progress announcements', () => {
	it.each([
		['image import', imageImportSource],
		['PDF import', pdfImportSource]
	])('%s exposes queue status changes to assistive technology', (_name, source) => {
		expect(source).toContain('role="status"');
		expect(source).toContain('aria-live="polite"');
		expect(source).toContain('aria-atomic="true"');
	});
});
