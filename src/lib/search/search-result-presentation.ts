export type SearchMatchMode =
	| 'lexical'
	| 'semantic'
	| 'visual'
	| 'hybrid'
	| 'lexical_visual'
	| 'semantic_visual'
	| 'hybrid_visual';

const LEXICAL_MATCH_MODES = new Set<SearchMatchMode>([
	'lexical',
	'hybrid',
	'lexical_visual',
	'hybrid_visual'
]);

export function hasLexicalEvidence(matchMode: SearchMatchMode) {
	return LEXICAL_MATCH_MODES.has(matchMode);
}

export function resultHighlightQuery(matchMode: SearchMatchMode, query: string) {
	return hasLexicalEvidence(matchMode) ? query.trim() : '';
}

export function searchResultHref(
	documentId: string,
	pageNumber: number,
	matchMode: SearchMatchMode,
	query: string
) {
	const base = `/documents/${documentId}/?page=${pageNumber}`;
	const highlight = resultHighlightQuery(matchMode, query);
	return highlight ? `${base}&highlight=${encodeURIComponent(highlight)}` : base;
}
