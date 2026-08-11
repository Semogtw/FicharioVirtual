import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/routes/import/drive/+page.svelte';

describe('explicit Google Drive import page', () => {
	it('dispatches small Drive files to local queues and oversized PDFs to durable references', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('selectGoogleDriveImportSource');
		expect(source).toContain('stageDrivePdfReference');
		expect(source).toContain('importStagedDrivePdfReference');
		expect(source).toContain('GOOGLE_PICKER_MIME_TYPES');
		expect(source).toContain('MAX_DIRECT_PICKER_DOWNLOAD_BYTES');
		expect(source).not.toContain('maximumBytes: 20 * 1024 * 1024');
		expect(source).toContain("selected.kind === 'reference'");
		expect(source).toContain("selected.selection.mimeType !== 'application/pdf'");
		expect(source).toContain('const staged = await stageDrivePdfReference');
		expect(source).toContain('await runReferenceImport(staged, selected.selection.name)');
		expect(source).toContain('addImages([selected.file]');
		expect(source).toContain('addPdfs([selected.file]');
		expect(source).toContain("label={selecting ? 'Abrindo Drive…' : 'Escolher no Google Drive'}");
	});

	it('reloads, resumes and safely cancels durable large-PDF references without reopening Picker', () => {
		const source = readFileSync(path, 'utf8');
		expect(source).toContain('listDrivePdfReferences');
		expect(source).toContain('deleteDocument');
		expect(source).toContain('async function loadPendingReferences');
		expect(source).toContain('async function resumeReference');
		expect(source).toContain('async function cancelReference');
		expect(source).toContain("reference.status === 'pending_inspection'");
		expect(source).toContain("status: 'pending_inspection'");
		expect(source).toContain('await deleteDocument(reference.documentId)');
		expect(source).toContain('await loadPendingReferences()');
		expect(source).toContain('PDFs grandes preservados');
		expect(source).toContain('label="Retomar"');
		expect(source).toContain('label="Parar processamento"');
		expect(source).toMatch(
			/label=\{deletingDocumentId === reference\.documentId\s*\? 'Excluindo…'\s*:\s*'Excluir cópia'\}/
		);
	});

	it('describes the direct browser ceiling and the reference path for larger PDFs', () => {
		const source = readFileSync(path, 'utf8');
		expect(source).toContain('download direto no navegador aceita até 50 MiB');
		expect(source).toMatch(/PDFs maiores são preservados no Drive e\s+preparados por referência/);
		expect(source).toContain('não é do documento lógico nem dos lotes de OCR');
	});

	it('avoids repeated OCR confirmations and never exposes or persists credentials', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).not.toContain('Confirme a autorização de OCR antes de selecionar o arquivo.');
		expect(source).not.toContain('type="checkbox"');
		expect(source).toContain('Nenhuma leitura ampla da conta é realizada.');
		expect(source).not.toContain('localStorage');
		expect(source).not.toContain('sessionStorage');
		expect(source).not.toContain('accessToken');
		expect(source).not.toContain('refreshToken');
	});
});
