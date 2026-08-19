import { describe, expect, it } from 'vitest';
import {
	appendUniqueDocumentResults,
	countExactQueryOccurrences
} from '$lib/search/document-search-results';
import type { SemanticSearchResult } from '$lib/services/semantic-search';

function result(input: {
	pageId: string;
	documentId: string;
	pageNumber: number;
	rank: number;
}): SemanticSearchResult {
	return {
		pageId: input.pageId,
		documentId: input.documentId,
		documentTitle: `Documento ${input.documentId}`,
		notebookId: null,
		notebookName: null,
		pageNumber: input.pageNumber,
		excerpt: 'trecho auxiliar',
		rank: input.rank,
		lexicalRank: input.rank,
		semanticSimilarity: 0,
		visualSimilarity: 0,
		matchMode: 'lexical'
	};
}

describe('document search result aggregation', () => {
	it('keeps only the highest-ranked first page hit for each document', () => {
		const first = result({
			pageId: '11111111-1111-4111-8111-111111111111',
			documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			pageNumber: 2,
			rank: 0.9
		});
		const duplicate = result({
			pageId: '22222222-2222-4222-8222-222222222222',
			documentId: first.documentId,
			pageNumber: 7,
			rank: 0.7
		});
		const other = result({
			pageId: '33333333-3333-4333-8333-333333333333',
			documentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
			pageNumber: 1,
			rank: 0.6
		});

		expect(appendUniqueDocumentResults([], [first, duplicate, other])).toEqual([first, other]);
	});

	it('counts whole-word and phrase occurrences without case or accent differences', () => {
		expect(countExactQueryOccurrences('Árvore árvore ARVORE; arvoredo.', 'árvore')).toBe(3);
		expect(
			countExactQueryOccurrences('Energia cinética e energia cinética.', 'energia cinética')
		).toBe(2);
		expect(countExactQueryOccurrences('fotossíntese fotossinteses', 'fotossíntese')).toBe(1);
	});
});
