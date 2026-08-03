import { describe, expect, it } from 'vitest';
import { parseImageImportResult } from '../../../src/lib/import/upload';

const expected = Object.freeze({
	documentId: '11111111-1111-4111-8111-111111111111',
	pageId: '22222222-2222-4222-8222-222222222222',
	ocrJobId: '33333333-3333-4333-8333-333333333333'
});

function row(overrides: Record<string, unknown> = {}) {
	return {
		document_id: expected.documentId,
		page_id: expected.pageId,
		ocr_job_id: expected.ocrJobId,
		...overrides
	};
}

describe('parseImageImportResult', () => {
	it('accepts and freezes the exact image import result', () => {
		const result = parseImageImportResult([row()], expected);

		expect(result).toEqual(expected);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it.each([
		null,
		[],
		[row(), row()],
		[{ document_id: expected.documentId, page_id: expected.pageId }],
		[row({ extra: true })],
		[row({ document_id: 'bad-id' })],
		[row({ document_id: '44444444-4444-4444-8444-444444444444' })],
		[row({ page_id: '44444444-4444-4444-8444-444444444444' })],
		[row({ ocr_job_id: '44444444-4444-4444-8444-444444444444' })]
	])('rejects malformed or inconsistent result %#', (value) => {
		expect(() => parseImageImportResult(value, expected)).toThrow('Invalid image import result');
	});

	it('rejects invalid expected identifiers', () => {
		expect(() => parseImageImportResult([row()], { ...expected, documentId: 'bad-id' })).toThrow(
			'Invalid image import result'
		);
	});
});
