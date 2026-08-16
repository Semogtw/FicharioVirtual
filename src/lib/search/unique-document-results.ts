type DocumentSearchResult = Readonly<{
	documentId: string;
}>;

/**
 * Keeps the highest-ranked occurrence of each document while preserving the
 * order supplied by the search service. The backend is expected to return one
 * row per document, but this defensive boundary prevents a duplicate row from
 * crashing keyed Svelte result rendering or reappearing across pagination.
 */
export function appendUniqueDocumentResults<T extends DocumentSearchResult>(
	existing: readonly T[],
	incoming: readonly T[]
): readonly T[] {
	const seen = new Set(existing.map((result) => result.documentId));
	const merged = [...existing];
	for (const result of incoming) {
		if (seen.has(result.documentId)) continue;
		seen.add(result.documentId);
		merged.push(result);
	}
	return Object.freeze(merged);
}
