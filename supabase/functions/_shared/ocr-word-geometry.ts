export type OcrWordGeometry = readonly [
	text: string,
	left: number,
	top: number,
	right: number,
	bottom: number
];

const MAX_WORDS = 20_000;
const MAX_WORD_LENGTH = 256;
const COMPACT_GEOMETRY = /^(\d{1,5}),(\d{1,5}),(\d{1,5}),(\d{1,5})\|(.+)$/u;

function validBox(text: string, left: number, top: number, right: number, bottom: number) {
	return (
		text.length >= 1 &&
		text.length <= MAX_WORD_LENGTH &&
		text === text.trim() &&
		!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) &&
		Number.isInteger(left) &&
		Number.isInteger(top) &&
		Number.isInteger(right) &&
		Number.isInteger(bottom) &&
		left >= 0 &&
		top >= 0 &&
		right <= 10_000 &&
		bottom <= 10_000 &&
		right > left &&
		bottom > top
	);
}

export function parseCompactWordGeometry(value: unknown): readonly OcrWordGeometry[] {
	if (!Array.isArray(value) || value.length > MAX_WORDS) return Object.freeze([]);
	const geometry: OcrWordGeometry[] = [];
	for (const item of value) {
		if (typeof item !== 'string' || item.length > 320) continue;
		const match = COMPACT_GEOMETRY.exec(item);
		if (!match) continue;
		const left = Number(match[1]);
		const top = Number(match[2]);
		const right = Number(match[3]);
		const bottom = Number(match[4]);
		const text = match[5]?.trim() ?? '';
		if (!validBox(text, left, top, right, bottom)) continue;
		geometry.push(Object.freeze([text, left, top, right, bottom] as const));
	}
	return Object.freeze(geometry);
}

export function parseStoredWordGeometry(value: unknown): readonly OcrWordGeometry[] {
	if (!Array.isArray(value) || value.length > MAX_WORDS) return Object.freeze([]);
	const geometry: OcrWordGeometry[] = [];
	for (const item of value) {
		if (!Array.isArray(item) || item.length !== 5) return Object.freeze([]);
		const [text, left, top, right, bottom] = item;
		if (
			typeof text !== 'string' ||
			typeof left !== 'number' ||
			typeof top !== 'number' ||
			typeof right !== 'number' ||
			typeof bottom !== 'number' ||
			!validBox(text, left, top, right, bottom)
		) {
			return Object.freeze([]);
		}
		geometry.push(Object.freeze([text, left, top, right, bottom] as const));
	}
	return Object.freeze(geometry);
}
