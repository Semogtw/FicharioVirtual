import { describe, expect, it } from 'vitest';
import { appendUniqueDocumentResults } from '../../../src/lib/search/unique-document-results';

describe('appendUniqueDocumentResults', () => {
	it('keeps the first ranked occurrence of each document inside a response batch', () => {
		const best = { documentId: 'document-a', rank: 0.9, pageNumber: 1 };
		const duplicate = { documentId: 'document-a', rank: 0.7, pageNumber: 2 };
		const second = { documentId: 'document-b', rank: 0.6, pageNumber: 1 };

		expect(appendUniqueDocumentResults([], [best, duplicate, second])).toEqual([best, second]);
	});

	it('does not re-add a document when consecutive result pages overlap', () => {
		const existing = { documentId: 'document-a', pageNumber: 1 };
		const duplicate = { documentId: 'document-a', pageNumber: 2 };
		const next = { documentId: 'document-b', pageNumber: 1 };

		expect(appendUniqueDocumentResults([existing], [duplicate, next])).toEqual([existing, next]);
	});
});
