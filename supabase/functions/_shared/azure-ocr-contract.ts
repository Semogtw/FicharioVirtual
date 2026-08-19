import type {
	OcrBatchPagePayload,
	OcrBatchRequestedPage,
	OcrContentClass
} from './ocr-batch-contract.ts';
import type { OcrWordGeometry } from './ocr-word-geometry.ts';

export type AzureReadOperationState = 'running' | 'succeeded' | 'failed';

export type AzureReadParsedOperation = Readonly<{
	state: AzureReadOperationState;
	page: OcrBatchPagePayload | null;
	modelVersion: string | null;
}>;

const MAX_LINES = 2_000;
const MAX_WORDS = 20_000;
const MAX_WORD_LENGTH = 256;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_DIMENSION = 100_000_000;
const STORED_COORDINATE_MAX = 10_000;
const PROVIDER_VERSION = /^[0-9A-Za-z._-]{1,128}$/u;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function safeDimension(value: unknown): number | null {
	return typeof value === 'number' &&
		Number.isFinite(value) &&
		value > 0 &&
		value <= MAX_DIMENSION
		? value
		: null;
}

function safeProviderVersion(value: unknown) {
	return typeof value === 'string' && PROVIDER_VERSION.test(value) ? value : null;
}

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

function normalizedBox(
	text: string,
	boundingBox: unknown,
	width: number,
	height: number
): OcrWordGeometry | null {
	if (
		text.length < 1 ||
		text.length > MAX_WORD_LENGTH ||
		text !== text.trim() ||
		hasForbiddenControlCharacter(text) ||
		!Array.isArray(boundingBox) ||
		boundingBox.length !== 8 ||
		boundingBox.some((value) => typeof value !== 'number' || !Number.isFinite(value))
	) {
		return null;
	}
	const xs = [boundingBox[0], boundingBox[2], boundingBox[4], boundingBox[6]] as number[];
	const ys = [boundingBox[1], boundingBox[3], boundingBox[5], boundingBox[7]] as number[];
	if (
		xs.some((value) => value < 0 || value > width) ||
		ys.some((value) => value < 0 || value > height)
	) {
		return null;
	}
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	if (maxX <= minX || maxY <= minY) return null;

	const left = Math.max(0, Math.min(STORED_COORDINATE_MAX - 1, Math.round((minX / width) * 10_000)));
	const top = Math.max(0, Math.min(STORED_COORDINATE_MAX - 1, Math.round((minY / height) * 10_000)));
	const right = Math.max(
		left + 1,
		Math.min(STORED_COORDINATE_MAX, Math.round((maxX / width) * 10_000))
	);
	const bottom = Math.max(
		top + 1,
		Math.min(STORED_COORDINATE_MAX, Math.round((maxY / height) * 10_000))
	);
	if (right > STORED_COORDINATE_MAX || bottom > STORED_COORDINATE_MAX) return null;
	return Object.freeze([text, left, top, right, bottom] as const);
}

function confidence(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
		? value
		: null;
}

function contentClass(readResult: Record<string, unknown>): OcrContentClass {
	const appearance = record(readResult.appearance);
	if (!appearance || !Array.isArray(appearance.styles)) return 'unknown';
	let handwriting = false;
	let other = false;
	for (const rawStyle of appearance.styles) {
		const style = record(rawStyle);
		if (!style) continue;
		if (style.name === 'handwriting') handwriting = true;
		else if (typeof style.name === 'string') other = true;
	}
	if (handwriting && other) return 'mixed';
	return handwriting ? 'handwriting' : 'unknown';
}

function parseSucceededPage(
	payload: Record<string, unknown>,
	requestedPage: OcrBatchRequestedPage,
	reviewConfidence: number | null
): OcrBatchPagePayload | null {
	const analyzeResult = record(payload.analyzeResult);
	if (!analyzeResult || !Array.isArray(analyzeResult.readResults) || analyzeResult.readResults.length !== 1) {
		return null;
	}
	const readResult = record(analyzeResult.readResults[0]);
	if (!readResult) return null;
	const width = safeDimension(readResult.width);
	const height = safeDimension(readResult.height);
	if (width === null || height === null || !Array.isArray(readResult.lines) || readResult.lines.length > MAX_LINES) {
		return null;
	}

	const lines: string[] = [];
	const geometry: OcrWordGeometry[] = [];
	let uncertain = false;
	for (const rawLine of readResult.lines) {
		const line = record(rawLine);
		if (!line || typeof line.text !== 'string' || line.text.length > MAX_TEXT_LENGTH) return null;
		const lineText = line.text.trimEnd();
		if (hasForbiddenControlCharacter(lineText)) return null;
		lines.push(lineText);
		if (!Array.isArray(line.words)) continue;
		for (const rawWord of line.words) {
			if (geometry.length >= MAX_WORDS) return null;
			const word = record(rawWord);
			if (!word || typeof word.text !== 'string') return null;
			const box = normalizedBox(word.text, word.boundingBox, width, height);
			if (!box) return null;
			geometry.push(box);
			const wordConfidence = confidence(word.confidence);
			if (reviewConfidence !== null && wordConfidence !== null && wordConfidence < reviewConfidence) {
				uncertain = true;
			}
		}
	}

	const text = lines.join('\n').trim();
	if (text.length > MAX_TEXT_LENGTH) return null;
	const warnings: Array<Readonly<{ code: string; message: string }>> = [];
	if (text.length === 0) {
		warnings.push(Object.freeze({ code: 'empty_page', message: 'Nenhum texto legível foi detectado.' }));
	}
	if (uncertain) {
		warnings.push(
			Object.freeze({
				code: 'uncertain_text',
				message: 'A leitura contém palavras com baixa confiança.'
			})
		);
	}

	return Object.freeze({
		pageId: requestedPage.pageId,
		pageNumber: requestedPage.pageNumber,
		text,
		warnings: Object.freeze(warnings),
		needsReview: warnings.length > 0,
		contentClass: contentClass(readResult),
		wordGeometry: Object.freeze(geometry)
	});
}

export function parseAzureReadOperation(
	value: unknown,
	requestedPage: OcrBatchRequestedPage,
	reviewConfidence: number | null = null
): AzureReadParsedOperation | null {
	if (
		reviewConfidence !== null &&
		(typeof reviewConfidence !== 'number' ||
			!Number.isFinite(reviewConfidence) ||
			reviewConfidence < 0 ||
			reviewConfidence > 1)
	) {
		throw new TypeError('Invalid Azure OCR review confidence');
	}
	const payload = record(value);
	if (!payload || typeof payload.status !== 'string') return null;
	const analyzeResult = record(payload.analyzeResult);
	const modelVersion = safeProviderVersion(analyzeResult?.version);

	if (payload.status === 'notStarted' || payload.status === 'running') {
		return Object.freeze({ state: 'running', page: null, modelVersion });
	}
	if (payload.status === 'failed') {
		return Object.freeze({ state: 'failed', page: null, modelVersion });
	}
	if (payload.status !== 'succeeded') return null;
	const page = parseSucceededPage(payload, requestedPage, reviewConfidence);
	if (!page) return null;
	return Object.freeze({ state: 'succeeded', page, modelVersion });
}
