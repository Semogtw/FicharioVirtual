import { describe, expect, it } from 'vitest';
import {
	hasLexicalEvidence,
	resultHighlightQuery,
	searchResultHref,
	type SearchMatchMode
} from '../../../src/lib/search/search-result-presentation';

const semanticOnlyModes: SearchMatchMode[] = ['semantic', 'visual', 'semantic_visual'];
const lexicalModes: SearchMatchMode[] = ['lexical', 'hybrid', 'lexical_visual', 'hybrid_visual'];

describe('search result presentation', () => {
	it.each(semanticOnlyModes)('does not invent lexical highlight for %s results', (matchMode) => {
		expect(hasLexicalEvidence(matchMode)).toBe(false);
		expect(resultHighlightQuery(matchMode, 'com apenas árvores')).toBe('');
		expect(searchResultHref('doc-id', 3, matchMode, 'com apenas árvores')).toBe(
			'/documents/doc-id/?page=3'
		);
	});

	it.each(lexicalModes)('keeps literal highlighting when %s has lexical evidence', (matchMode) => {
		expect(hasLexicalEvidence(matchMode)).toBe(true);
		expect(resultHighlightQuery(matchMode, '  arborização urbana  ')).toBe('arborização urbana');
		expect(searchResultHref('doc-id', 2, matchMode, '  arborização urbana  ')).toBe(
			'/documents/doc-id/?page=2&highlight=arboriza%C3%A7%C3%A3o%20urbana'
		);
	});
});
