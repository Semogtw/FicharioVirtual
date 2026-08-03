import { describe, expect, it } from 'vitest';
import { parsePdfWorkerResponse } from '../../../src/lib/pdf/inspector-client';

const id = 'pdf-task-1';

function inspection(overrides: Record<string, unknown> = {}) {
	return {
		type: 'Mixed',
		pageCount: 3,
		nativePages: [
			{ pageNumber: 1, text: 'Texto um' },
			{ pageNumber: 3, text: 'Texto três' }
		],
		pagesNeedingOcr: [2],
		ocrReasonsByPage: [{ pageNumber: 2, reasons: ['no_text_operators'] }],
		markdown: '<!-- Page 1 -->\nTexto um',
		title: 'Apostila',
		confidence: 0.9,
		processingTimeMs: 10,
		layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
		hasEncodingIssues: false,
		...overrides
	};
}

describe('parsePdfWorkerResponse', () => {
	it('accepts and freezes an exact successful inspection response', () => {
		const result = parsePdfWorkerResponse({ type: 'success', id, inspection: inspection() }, id);

		expect(result.type).toBe('success');
		if (result.type !== 'success') throw new Error('Expected success');
		expect(result.inspection).toEqual(inspection());
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.inspection)).toBe(true);
		expect(result.inspection.nativePages.every(Object.isFrozen)).toBe(true);
	});

	it('accepts exact documented inspection failures', () => {
		expect(parsePdfWorkerResponse({ type: 'failure', id, code: 'encrypted_pdf' }, id)).toEqual({
			type: 'failure',
			id,
			code: 'encrypted_pdf'
		});
	});

	it.each([
		null,
		{},
		{ type: 'failure', id: 'other', code: 'invalid_pdf' },
		{ type: 'failure', id, code: 'unknown' },
		{ type: 'failure', id, code: 'invalid_pdf', extra: true },
		{ type: 'success', id: 'other', inspection: inspection() },
		{ type: 'success', id, inspection: inspection({ pageCount: 0 }) },
		{
			type: 'success',
			id,
			inspection: inspection({
				nativePages: [{ pageNumber: 2, text: 'overlap' }]
			})
		},
		{
			type: 'success',
			id,
			inspection: inspection({
				layout: { isComplex: false, pagesWithTables: [4], pagesWithColumns: [] }
			})
		},
		{ type: 'success', id, inspection: inspection(), extra: true }
	])('rejects malformed inspection worker response %#', (value) => {
		expect(() => parsePdfWorkerResponse(value, id)).toThrow('Invalid PDF worker response');
	});
});
