export type HighlightPart = {
	text: string;
	highlighted: boolean;
};

type NormalizedText = {
	value: string;
	originalIndexes: readonly number[];
};

function normalizeWithIndexes(input: string): NormalizedText {
	let value = '';
	const originalIndexes: number[] = [];
	for (let index = 0; index < input.length; index += 1) {
		const character = input[index] ?? '';
		const normalized = character
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLocaleLowerCase('pt-BR');
		for (const output of normalized) {
			value += output;
			originalIndexes.push(index);
		}
	}
	return { value, originalIndexes: Object.freeze(originalIndexes) };
}

function queryTerms(query: string) {
	return [...new Set(
		query
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLocaleLowerCase('pt-BR')
			.split(/[^\p{L}\p{N}_-]+/u)
			.map((term) => term.trim())
			.filter((term) => term.length >= 2)
	)].sort((left, right) => right.length - left.length);
}

export function highlightSnippet(snippet: string, query: string): readonly HighlightPart[] {
	if (snippet.length === 0) return Object.freeze([]);
	const terms = queryTerms(query);
	if (terms.length === 0) return Object.freeze([{ text: snippet, highlighted: false }]);

	const normalized = normalizeWithIndexes(snippet);
	const covered = new Uint8Array(snippet.length);
	for (const term of terms) {
		let offset = 0;
		while (offset < normalized.value.length) {
			const match = normalized.value.indexOf(term, offset);
			if (match < 0) break;
			const first = normalized.originalIndexes[match];
			const last = normalized.originalIndexes[match + term.length - 1];
			if (first !== undefined && last !== undefined) covered.fill(1, first, last + 1);
			offset = match + Math.max(term.length, 1);
		}
	}

	const parts: HighlightPart[] = [];
	let start = 0;
	let state = covered[0] === 1;
	for (let index = 1; index <= snippet.length; index += 1) {
		const next = index < snippet.length ? covered[index] === 1 : !state;
		if (next === state && index < snippet.length) continue;
		parts.push(Object.freeze({ text: snippet.slice(start, index), highlighted: state }));
		start = index;
		state = next;
	}
	return Object.freeze(parts.filter((part) => part.text.length > 0));
}
