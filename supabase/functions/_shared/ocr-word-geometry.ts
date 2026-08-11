export type OcrWordGeometry = readonly [
	text: string,
	left: number,
	top: number,
	right: number,
	bottom: number
];

const MAX_WORDS = 20_000;
const MAX_WORD_LENGTH = 256;
const MAX_LINES = 2_000;
const PROVIDER_COORDINATE_MAX = 1_000;
const STORED_COORDINATE_MAX = 10_000;
const COMPACT_LINE_GEOMETRY = /^(\d{1,4}),(\d{1,4}),(\d{1,4}),(\d{1,4})$/u;
const WORD = /\S+/gu;

function hasForbiddenControlCharacter(text: string) {
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (
			code <= 0x08 ||
			code === 0x0b ||
			code === 0x0c ||
			(code >= 0x0e && code <= 0x1f) ||
			code === 0x7f
		) {
			return true;
		}
	}
	return false;
}

function validBox(text: string, left: number, top: number, right: number, bottom: number) {
	return (
		text.length >= 1 &&
		text.length <= MAX_WORD_LENGTH &&
		text === text.trim() &&
		!hasForbiddenControlCharacter(text) &&
		Number.isInteger(left) &&
		Number.isInteger(top) &&
		Number.isInteger(right) &&
		Number.isInteger(bottom) &&
		left >= 0 &&
		top >= 0 &&
		right <= STORED_COORDINATE_MAX &&
		bottom <= STORED_COORDINATE_MAX &&
		right > left &&
		bottom > top
	);
}

function nonEmptyLines(text: string) {
	return text
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function parseProviderLineBox(value: unknown) {
	if (typeof value !== 'string' || value.length > 32) return null;
	const match = COMPACT_LINE_GEOMETRY.exec(value);
	if (!match) return null;
	const left = Number(match[1]);
	const top = Number(match[2]);
	const right = Number(match[3]);
	const bottom = Number(match[4]);
	if (
		![left, top, right, bottom].every(Number.isInteger) ||
		left < 0 ||
		top < 0 ||
		right > PROVIDER_COORDINATE_MAX ||
		bottom > PROVIDER_COORDINATE_MAX ||
		right <= left ||
		bottom <= top
	) {
		return null;
	}
	return Object.freeze({
		left: left * 10,
		top: top * 10,
		right: right * 10,
		bottom: bottom * 10
	});
}

function deriveWordsForLine(
	line: string,
	box: Readonly<{ left: number; top: number; right: number; bottom: number }>
) {
	const matches = [...line.matchAll(WORD)];
	if (matches.length === 0) return Object.freeze([] as OcrWordGeometry[]);
	const lineLength = Math.max(1, line.length);
	const width = box.right - box.left;
	const words: OcrWordGeometry[] = [];
	for (const match of matches) {
		const text = match[0];
		const start = match.index ?? 0;
		const end = start + text.length;
		let left = box.left + Math.round((width * start) / lineLength);
		let right = box.left + Math.round((width * end) / lineLength);
		left = Math.min(Math.max(left, box.left), box.right - 1);
		right = Math.max(left + 1, Math.min(right, box.right));
		if (!validBox(text, left, box.top, right, box.bottom)) continue;
		words.push(Object.freeze([text, left, box.top, right, box.bottom] as const));
		if (words.length >= MAX_WORDS) break;
	}
	return Object.freeze(words);
}

/**
 * Gemini returns one compact box per non-empty transcription line, in the same
 * order as the text. Word boxes are derived locally from the line span. This
 * keeps provider output small while retaining word-level search highlights.
 */
export function deriveWordGeometryFromLines(
	value: unknown,
	text: string
): readonly OcrWordGeometry[] {
	if (!Array.isArray(value) || value.length > MAX_LINES || text.length === 0) {
		return Object.freeze([]);
	}
	const lines = nonEmptyLines(text);
	if (lines.length === 0 || value.length !== lines.length) return Object.freeze([]);
	const boxes = value.map(parseProviderLineBox);
	if (boxes.some((box) => box === null)) return Object.freeze([]);
	const geometry: OcrWordGeometry[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]!;
		const box = boxes[index]!;
		if (!box) return Object.freeze([]);
		for (const word of deriveWordsForLine(line, box)) {
			geometry.push(word);
			if (geometry.length >= MAX_WORDS) return Object.freeze(geometry);
		}
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
