import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/routes/import/drive/+page.svelte';

describe('explicit Google Drive import page', () => {
	it('dispatches small Drive files to local queues and oversized PDFs to durable references', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('selectGoogleDriveImportSource');
		expect(source).toContain('stageDrivePdfReference');
		expect(source).toContain('GOOGLE_PICKER_MIME_TYPES');
		expect(source).toContain('MAX_DIRECT_PICKER_DOWNLOAD_BYTES');
		expect(source).not.toContain('maximumBytes: 20 * 1024 * 1024');
		expect(source).toContain("selected.kind === 'reference'");
		expect(source).toContain("selected.selection.mimeType !== 'application/pdf'");
		expect(source).toContain('addImages([selected.file]');
		expect(source).toContain('addPdfs([selected.file]');
		expect(source).toContain("label={selecting ? 'Abrindo Drive…' : 'Escolher no Google Drive'}");
	});

	it('describes the direct browser ceiling and the reference path for larger PDFs', () => {
		const source = readFileSync(path, 'utf8');
		expect(source).toContain('download direto no navegador aceita até 50 MiB');
		expect(source).toContain('PDFs maiores são preservados no Drive e preparados por referência');
		expect(source).toContain('não do documento lógico nem dos lotes de OCR');
	});

	it('requires explicit OCR consent and never exposes or persists credentials', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('Confirme a autorização de OCR antes de selecionar o arquivo.');
		expect(source).toContain('Nenhuma leitura ampla da conta é realizada.');
		expect(source).not.toContain('localStorage');
		expect(source).not.toContain('sessionStorage');
		expect(source).not.toContain('accessToken');
		expect(source).not.toContain('refreshToken');
	});
});
