import { describe, expect, it } from 'vitest';
import { routePdfProcessResult } from '../../../src/lib/pdf/types';

const layout = {
	isComplex: false,
	pagesWithTables: [],
	pagesWithColumns: []
};

describe('PDF page routing', () => {
	it('keeps every text page local when no page needs OCR', () => {
		const result = routePdfProcessResult({
			pdfType: 'TextBased',
			pageCount: 2,
			processingTimeMs: 12,
			pagesNeedingOcr: [],
			ocrReasonsByPage: [],
			confidence: 0.99,
			layout,
			hasEncodingIssues: false,
			markdown: '<!-- Page 1 -->\n# Introdução\n\n<!-- Page 2 -->\nConteúdo final'
		});

		expect(result.pagesNeedingOcr).toEqual([]);
		expect(result.nativePages).toEqual([
			{ pageNumber: 1, text: '# Introdução' },
			{ pageNumber: 2, text: 'Conteúdo final' }
		]);
	});

	it('routes every page of a scanned document to OCR', () => {
		const result = routePdfProcessResult({
			pdfType: 'Scanned',
			pageCount: 3,
			processingTimeMs: 8,
			pagesNeedingOcr: [1, 2, 3],
			ocrReasonsByPage: [],
			confidence: 0.96,
			layout,
			hasEncodingIssues: false
		});

		expect(result.nativePages).toEqual([]);
		expect(result.pagesNeedingOcr).toEqual([1, 2, 3]);
	});

	it('preserves native text and routes only missing mixed pages', () => {
		const result = routePdfProcessResult({
			pdfType: 'Mixed',
			pageCount: 3,
			processingTimeMs: 15,
			pagesNeedingOcr: [2],
			ocrReasonsByPage: [{ page: 2, reasons: ['no_text_operators'] }],
			confidence: 0.87,
			layout: { ...layout, isComplex: true, pagesWithTables: [3] },
			hasEncodingIssues: false,
			markdown:
				'<!-- Page 1 -->\nTexto nativo\n\n<!-- Page 2 -->\n\n<!-- Page 3 -->\nTabela extraída'
		});

		expect(result.nativePages).toEqual([
			{ pageNumber: 1, text: 'Texto nativo' },
			{ pageNumber: 3, text: 'Tabela extraída' }
		]);
		expect(result.pagesNeedingOcr).toEqual([2]);
		expect(result.ocrReasonsByPage).toEqual([{ pageNumber: 2, reasons: ['no_text_operators'] }]);
	});

	it('rejects invalid page routing returned by the dependency', () => {
		expect(() =>
			routePdfProcessResult({
				pdfType: 'Mixed',
				pageCount: 2,
				processingTimeMs: 1,
				pagesNeedingOcr: [0, 3],
				ocrReasonsByPage: [],
				confidence: 0.5,
				layout,
				hasEncodingIssues: false
			})
		).toThrow('Invalid PDF inspection result');
	});
});
