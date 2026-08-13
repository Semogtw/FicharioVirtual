import { normalizeSemanticDocumentText } from './semantic-text.ts';

export type SemanticTextChunk = Readonly<{
	index: number;
	text: string;
}>;

export const SEMANTIC_CHUNK_MAX_CHARS = 1_800;
export const SEMANTIC_CHUNK_OVERLAP_CHARS = 220;
export const SEMANTIC_MAX_CHUNKS_PER_PAGE = 16;

function backwardBoundary(source: string, start: number, idealEnd: number) {
	if (idealEnd >= source.length) return source.length;
	const minimum = start + Math.floor(SEMANTIC_CHUNK_MAX_CHARS * 0.62);
	for (let cursor = idealEnd; cursor >= minimum; cursor -= 1) {
		const character = source[cursor - 1];
		if (
			character === '\n' ||
			character === '.' ||
			character === '?' ||
			character === '!' ||
			character === ';'
		) {
			return cursor;
		}
	}
	for (let cursor = idealEnd; cursor >= minimum; cursor -= 1) {
		if (/\s/u.test(source[cursor - 1] ?? '')) return cursor;
	}
	return idealEnd;
}

function nextStart(source: string, start: number, end: number) {
	if (end >= source.length) return source.length;
	let cursor = Math.max(start + 1, end - SEMANTIC_CHUNK_OVERLAP_CHARS);
	while (cursor < end && cursor < source.length && !/\s/u.test(source[cursor - 1] ?? '')) {
		cursor += 1;
	}
	while (cursor < source.length && /\s/u.test(source[cursor] ?? '')) cursor += 1;
	return cursor;
}

export function chunkSemanticText(value: string): readonly SemanticTextChunk[] {
	const source = normalizeSemanticDocumentText(value);
	if (!source) return Object.freeze([]);

	const chunks: SemanticTextChunk[] = [];
	let start = 0;
	while (start < source.length && chunks.length < SEMANTIC_MAX_CHUNKS_PER_PAGE) {
		const idealEnd = Math.min(source.length, start + SEMANTIC_CHUNK_MAX_CHARS);
		const end = backwardBoundary(source, start, idealEnd);
		const text = source.slice(start, end).trim();
		if (text) chunks.push(Object.freeze({ index: chunks.length, text }));
		if (end >= source.length) break;
		const candidate = nextStart(source, start, end);
		if (candidate <= start) break;
		start = candidate;
	}
	return Object.freeze(chunks);
}
