import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/import/+page.svelte', 'utf8');

describe('main import file picker', () => {
	it('offers PDFs and supported images from the same file picker', () => {
		expect(source).toContain('Selecionar arquivos');
		expect(source).toContain('accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"');
	});

	it('routes PDFs to the PDF import queue while preserving the camera-only image action', () => {
		expect(source).toContain("import { addPdfs, pdfImportQueue } from '$lib/stores/pdf-import-queue.svelte';");
		expect(source).toContain('addPdfs(pdfs, { notebookId: notebookId || null, consentGranted: consent });');
		expect(source).toContain('accept="image/*" capture="environment"');
	});

	it('recognizes PDFs by MIME type or extension for mobile file providers', () => {
		expect(source).toContain("file.type === 'application/pdf' || /\\.pdf$/i.test(file.name)");
	});
});
