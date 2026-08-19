import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync('src/routes/import/+layout.svelte', 'utf8');
const imagePageSource = readFileSync('src/routes/import/+page.svelte', 'utf8');
const pdfPageSource = readFileSync('src/routes/import/pdf/+page.svelte', 'utf8');

describe('unified import navigation', () => {
	it('does not present image and PDF routes as different import experiences', () => {
		expect(layoutSource).not.toContain('Imagens e câmera');
		expect(layoutSource).not.toContain('PDFs e arquivos');
		expect(layoutSource).not.toContain('import-tabs');
	});

	it('keeps old image and PDF routes on the same unified import surface', () => {
		expect(imagePageSource).toContain('<UnifiedImportPage />');
		expect(pdfPageSource).toContain('<UnifiedImportPage />');
	});
});
