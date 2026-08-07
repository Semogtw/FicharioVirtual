import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/import/drive/+page.svelte', 'utf8');

describe('active oversized Drive PDF cancellation', () => {
	it('uses AbortController to stop processing without invoking destructive reference deletion', () => {
		expect(source).toContain('new AbortController()');
		expect(source).toContain('signal: controller.signal');
		expect(source).toContain('onProgress:');
		expect(source).toContain('controller.abort()');
		expect(source).toContain("'AbortError'");
		expect(source).toContain('Parar processamento');
		expect(source).toContain('sem apagar o estado durável');
		expect(source).toContain('await loadPendingReferences()');
	});

	it('keeps destructive deletion as a separate explicit action', () => {
		expect(source).toContain('async function cancelReference');
		expect(source).toContain('await deleteDocument(reference.documentId)');
		expect(source).toContain('Excluir cópia');
		expect(source).toContain('async function stopReferenceProcessing');
	});

	it('surfaces phase and page progress for the active durable reference', () => {
		expect(source).toContain('DrivePdfReferenceImportProgress');
		expect(source).toContain('referenceProgress');
		expect(source).toContain("phase === 'inspecting'");
		expect(source).toContain("phase === 'rendering_ocr'");
		expect(source).toContain("phase === 'ocr'");
		expect(source).toContain('role="status"');
	});
});
