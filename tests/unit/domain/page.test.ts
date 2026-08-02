import { describe, expect, it } from 'vitest';
import { effectivePageText, mapPageRecord } from '../../../src/lib/domain/page';

describe('effectivePageText', () => {
	it('prefers corrected text over native and OCR sources', () => {
		expect(
			effectivePageText({
				correctedText: 'Versão corrigida',
				nativeText: 'Versão nativa',
				ocrRawText: 'Versão OCR'
			})
		).toBe('Versão corrigida');
	});

	it('falls back from native PDF text to OCR and then to empty text', () => {
		expect(effectivePageText({ correctedText: null, nativeText: 'PDF', ocrRawText: 'OCR' })).toBe(
			'PDF'
		);
		expect(effectivePageText({ correctedText: null, nativeText: null, ocrRawText: 'OCR' })).toBe(
			'OCR'
		);
		expect(effectivePageText({ correctedText: null, nativeText: null, ocrRawText: null })).toBe('');
	});
});

describe('mapPageRecord', () => {
	it('maps only safe page fields and normalizes malformed warnings', () => {
		const page = mapPageRecord({
			id: 'page-1',
			page_number: 2,
			native_text: null,
			ocr_raw_text: 'Texto',
			corrected_text: null,
			extraction_source: 'ocr',
			warnings: [{ code: 'uncertain_text', message: 'Trecho incerto' }, { raw: true }],
			status: 'needs_review',
			was_manually_reviewed: false,
			updated_at: '2026-08-02T02:00:00.000Z'
		});

		expect(page.text).toBe('Texto');
		expect(page.warnings).toEqual([{ code: 'uncertain_text', message: 'Trecho incerto' }]);
		expect(page).not.toHaveProperty('temporary_image_path');
	});
});
