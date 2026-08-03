import { describe, expect, it } from 'vitest';
import { parsePdfImportPublication } from '../../../src/lib/pdf/upload';

const documentId = '11111111-1111-4111-8111-111111111111';

describe('parsePdfImportPublication', () => {
	it('accepts and freezes the exact publication contract', () => {
		const result = parsePdfImportPublication({
			documentId,
			pageCount: 3,
			ocrPageCount: 1,
			reviewPageCount: 0,
			status: 'partially_ready'
		});

		expect(result).toEqual({
			documentId,
			pageCount: 3,
			ocrPageCount: 1,
			reviewPageCount: 0,
			status: 'partially_ready'
		});
		expect(Object.isFrozen(result)).toBe(true);
	});

	it.each([
		{ documentId: 'bad-id', pageCount: 1, ocrPageCount: 0, reviewPageCount: 0, status: 'ready' },
		{ documentId, pageCount: 0, ocrPageCount: 0, reviewPageCount: 0, status: 'ready' },
		{ documentId, pageCount: 2, ocrPageCount: 3, reviewPageCount: 0, status: 'processing' },
		{ documentId, pageCount: 2, ocrPageCount: 1, reviewPageCount: 1, status: 'partially_ready' },
		{ documentId, pageCount: 2, ocrPageCount: 0, reviewPageCount: 0, status: 'failed' },
		{ documentId, pageCount: 2, ocrPageCount: 2, reviewPageCount: 0, status: 'partially_ready' },
		{
			documentId,
			pageCount: 2,
			ocrPageCount: 0,
			reviewPageCount: 0,
			status: 'ready',
			extra: true
		}
	])('rejects malformed publication %#', (value) => {
		expect(() => parsePdfImportPublication(value)).toThrow('Invalid PDF import publication');
	});
});
