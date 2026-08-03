import { describe, expect, it } from 'vitest';
import { parseDuplicateDocumentId } from '../../../src/lib/import/duplicate-result';

const documentId = '11111111-1111-4111-8111-111111111111';

describe('parseDuplicateDocumentId', () => {
	it('returns null when no duplicate exists', () => {
		expect(parseDuplicateDocumentId(null)).toBeNull();
	});

	it('returns the exact duplicate document identifier', () => {
		expect(parseDuplicateDocumentId({ id: documentId })).toBe(documentId);
	});

	it.each([
		undefined,
		[],
		{},
		{ id: 'bad-id' },
		{ id: documentId, title: 'unexpected' },
		[{ id: documentId }]
	])('rejects malformed duplicate response %#', (value) => {
		expect(() => parseDuplicateDocumentId(value)).toThrow('Invalid duplicate document response');
	});
});
