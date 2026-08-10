import type { Json } from '$lib/types/database';
import { highlightSnippet } from '$lib/search/highlight';

export type WordGeometry = Readonly<{
	text: string;
	left: number;
	top: number;
	right: number;
	bottom: number;
}>;

function validCoordinate(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000;
}

export function parseWordGeometry(value: Json): readonly WordGeometry[] {
	if (!Array.isArray(value) || value.length > 20_000) return Object.freeze([]);
	const geometry: WordGeometry[] = [];
	for (const item of value) {
		if (!Array.isArray(item) || item.length !== 5) return Object.freeze([]);
		const [text, left, top, right, bottom] = item;
		if (
			typeof text !== 'string' ||
			text.length < 1 ||
			text.length > 256 ||
			text !== text.trim() ||
			!validCoordinate(left) ||
			!validCoordinate(top) ||
			!validCoordinate(right) ||
			!validCoordinate(bottom) ||
			right <= left ||
			bottom <= top
		) {
			return Object.freeze([]);
		}
		geometry.push(Object.freeze({ text, left, top, right, bottom }));
	}
	return Object.freeze(geometry);
}

export function matchingWordGeometry(
	geometry: readonly WordGeometry[],
	query: string
): readonly WordGeometry[] {
	if (!query.trim()) return Object.freeze([]);
	return Object.freeze(
		geometry.filter((box) => highlightSnippet(box.text, query).some((part) => part.highlighted))
	);
}

export function geometryPercent(value: number) {
	return `${value / 100}%`;
}
