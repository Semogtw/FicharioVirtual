import type { PageDetail } from '$lib/domain/page';
import type { SemanticSearchResult } from '$lib/services/semantic-search';

function normalize(value: string) {
	return value
		.normalize('NFD')
		.replace(/\p{M}+/gu, '')
		.toLocaleLowerCase('pt-BR')
		.replace(/\s+/g, ' ')
		.trim();
}

function isWordCharacter(value: string | undefined) {
	return value !== undefined && /[\p{L}\p{N}]/u.test(value);
}

export function appendUniqueDocumentResults(
	current: readonly SemanticSearchResult[],
	incoming: readonly SemanticSearchResult[]
): readonly SemanticSearchResult[] {
	const seen = new Set(current.map((result) => result.documentId));
	const merged = [...current];
	for (const result of incoming) {
		if (seen.has(result.documentId)) continue;
		seen.add(result.documentId);
		merged.push(result);
	}
	return Object.freeze(merged);
}

export function countExactQueryOccurrences(text: string, query: string) {
	const haystack = normalize(text);
	const needle = normalize(query);
	if (!haystack || !needle) return 0;

	let count = 0;
	let from = 0;
	while (from <= haystack.length - needle.length) {
		const index = haystack.indexOf(needle, from);
		if (index < 0) break;
		const before = index > 0 ? haystack[index - 1] : undefined;
		const afterIndex = index + needle.length;
		const after = afterIndex < haystack.length ? haystack[afterIndex] : undefined;
		if (!isWordCharacter(before) && !isWordCharacter(after)) count += 1;
		from = index + Math.max(needle.length, 1);
	}
	return count;
}

export function countDocumentQueryOccurrences(pages: readonly PageDetail[], query: string) {
	return pages.reduce((total, page) => total + countExactQueryOccurrences(page.text, query), 0);
}
