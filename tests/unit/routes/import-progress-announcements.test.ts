import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const unifiedImportSource = readFileSync('src/lib/components/UnifiedImportPage.svelte', 'utf8');
const pdfImportSource = readFileSync('src/routes/import/pdf/+page.svelte', 'utf8');

describe('import progress announcements', () => {
	it('uses status semantics for unified import feedback', () => {
		expect(unifiedImportSource).toContain('role="status"');
	});

	it('keeps explicit live-region semantics in the dedicated PDF queue', () => {
		expect(pdfImportSource).toContain('role="status"');
		expect(pdfImportSource).toContain('aria-live="polite"');
		expect(pdfImportSource).toContain('aria-atomic="true"');
	});
});
