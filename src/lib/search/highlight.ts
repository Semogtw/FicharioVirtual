export type HighlightPart = {
	text: string;
	highlighted: boolean;
};

type NormalizedText = {
	value: string;
	originalIndexes: readonly number[];
};

type TokenRange = {
	start: number;
	end: number;
	normalized: string;
};

function normalizeSearchValue(input: string) {
	return input
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase('pt-BR');
}

function normalizeWithIndexes(input: string): NormalizedText {
	let value = '';
	const originalIndexes: number[] = [];
	for (let index = 0; index < input.length; index += 1) {
		const character = input[index] ?? '';
		const normalized = normalizeSearchValue(character);
		for (const output of normalized) {
			value += output;
			originalIndexes.push(index);
		}
	}
	return { value, originalIndexes: Object.freeze(originalIndexes) };
}

function queryTerms(query: string) {
	return [
		...new Set(
			normalizeSearchValue(query)
				.split(/[^\p{L}\p{N}_-]+/u)
				.map((term) => term.trim())
				.filter((term) => term.length >= 2)
		)
	].sort((left, right) => right.length - left.length);
}

function tokenRanges(input: string): readonly TokenRange[] {
	const ranges: TokenRange[] = [];
	for (const match of input.matchAll(/[\p{L}\p{N}_’'-]+/gu)) {
		const text = match[0];
		const start = match.index;
		if (start === undefined || text.length === 0) continue;
		ranges.push({
			start,
			end: start + text.length,
			normalized: normalizeSearchValue(text)
		});
	}
	return Object.freeze(ranges);
}

function editDistance(left: string, right: string) {
	if (left === right) return 0;
	if (left.length === 0) return right.length;
	if (right.length === 0) return left.length;

	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = new Array<number>(right.length + 1);
		current[0] = leftIndex;
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
			current[rightIndex] = Math.min(
				(previous[rightIndex] ?? Number.POSITIVE_INFINITY) + 1,
				(current[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + 1,
				(previous[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + substitutionCost
			);
		}
		previous = current;
	}
	return previous[right.length] ?? Math.max(left.length, right.length);
}

function fuzzyThreshold(termLength: number) {
	if (termLength >= 8) return 0.68;
	if (termLength >= 5) return 0.72;
	return 0.75;
}

function fuzzySimilarity(left: string, right: string) {
	const maximum = Math.max(left.length, right.length);
	if (maximum === 0) return 1;
	return 1 - editDistance(left, right) / maximum;
}

function buildCoverage(snippet: string, query: string) {
	const terms = queryTerms(query);
	const covered = new Uint8Array(snippet.length);
	if (terms.length === 0 || snippet.length === 0) return covered;

	const normalized = normalizeWithIndexes(snippet);
	const tokens = tokenRanges(snippet);
	for (const term of terms) {
		let offset = 0;
		let foundExact = false;
		while (offset < normalized.value.length) {
			const match = normalized.value.indexOf(term, offset);
			if (match < 0) break;
			const first = normalized.originalIndexes[match];
			const last = normalized.originalIndexes[match + term.length - 1];
			if (first !== undefined && last !== undefined) {
				covered.fill(1, first, last + 1);
				foundExact = true;
			}
			offset = match + Math.max(term.length, 1);
		}

		if (foundExact || term.length < 4) continue;
		const maximumLengthDifference = Math.max(2, Math.floor(term.length * 0.35));
		const threshold = fuzzyThreshold(term.length);
		let bestScore = 0;
		const fuzzyCandidates: Array<{ range: TokenRange; score: number }> = [];
		for (const range of tokens) {
			if (range.normalized.length < 3) continue;
			if (Math.abs(range.normalized.length - term.length) > maximumLengthDifference) continue;
			const score = fuzzySimilarity(range.normalized, term);
			if (score < threshold) continue;
			bestScore = Math.max(bestScore, score);
			fuzzyCandidates.push({ range, score });
		}

		for (const candidate of fuzzyCandidates) {
			if (candidate.score + 0.04 < bestScore) continue;
			covered.fill(1, candidate.range.start, candidate.range.end);
		}
	}
	return covered;
}

export function highlightSnippet(snippet: string, query: string): readonly HighlightPart[] {
	if (snippet.length === 0) return Object.freeze([]);
	const covered = buildCoverage(snippet, query);
	if (!covered.includes(1)) return Object.freeze([{ text: snippet, highlighted: false }]);

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

export function searchMatchSnippet(text: string, query: string, maximumLength = 360) {
	if (text.length === 0) return '';
	const targetLength = Math.min(Math.max(Math.trunc(maximumLength), 80), 1000);
	if (text.length <= targetLength) return text;

	const covered = buildCoverage(text, query);
	const firstMatch = covered.indexOf(1);
	if (firstMatch < 0) return `${text.slice(0, targetLength).trimEnd()}…`;

	let matchEnd = firstMatch + 1;
	while (matchEnd < covered.length && covered[matchEnd] === 1) matchEnd += 1;
	const matchLength = matchEnd - firstMatch;
	let start = Math.max(0, firstMatch - Math.floor((targetLength - matchLength) / 2));
	start = Math.min(start, Math.max(0, text.length - targetLength));
	const end = Math.min(text.length, start + targetLength);
	const excerpt = text.slice(start, end).trim();
	return `${start > 0 ? '…' : ''}${excerpt}${end < text.length ? '…' : ''}`;
}
