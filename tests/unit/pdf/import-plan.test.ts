import { describe, expect, it } from 'vitest';
import { buildPdfImportPlan } from '../../../src/lib/pdf/import-plan';
import type { PdfInspection } from '../../../src/lib/pdf/types';

function inspection(overrides: Partial<PdfInspection> = {}): PdfInspection {
	return {
		type: 'Mixed',
		pageCount: 3,
		nativePages: [
			{ pageNumber: 1, text: 'Texto da página um' },
			{ pageNumber: 3, text: 'Texto da página três' }
		],
		pagesNeedingOcr: [2],
		ocrReasonsByPage: [{ pageNumber: 2, reasons: ['no_text_operators'] }],
		markdown: null,
		title: null,
		confidence: 0.9,
		processingTimeMs: 10,
		layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
		hasEncodingIssues: false,
		...overrides
	};
}

describe('buildPdfImportPlan', () => {
	it('creates one continuous descriptor per PDF page', () => {
		const plan = buildPdfImportPlan(inspection(), 'document-id');

		expect(plan).toEqual([
			{
				id: expect.any(String),
				pageNumber: 1,
				nativeText: 'Texto da página um',
				needsOcr: false,
				temporaryImagePath: null,
				jobId: null
			},
			{
				id: expect.any(String),
				pageNumber: 2,
				nativeText: null,
				needsOcr: true,
				temporaryImagePath: 'document-id/pages/2.webp',
				jobId: expect.any(String)
			},
			{
				id: expect.any(String),
				pageNumber: 3,
				nativeText: 'Texto da página três',
				needsOcr: false,
				temporaryImagePath: null,
				jobId: null
			}
		]);
	});

	it('marks a missing non-OCR text page for review instead of dropping it', () => {
		const plan = buildPdfImportPlan(
			inspection({
				pageCount: 2,
				nativePages: [{ pageNumber: 1, text: 'Disponível' }],
				pagesNeedingOcr: []
			}),
			'document-id'
		);

		expect(plan[1]).toEqual(
			expect.objectContaining({ pageNumber: 2, nativeText: '', needsOcr: false })
		);
	});

	it('rejects an unsafe storage root', () => {
		expect(() => buildPdfImportPlan(inspection(), '../escape')).toThrow('Invalid PDF storage root');
	});
});
