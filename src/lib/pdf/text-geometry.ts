import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { WordGeometry } from '$lib/ocr/word-geometry';
import { safelyWipeBytes } from './safe-wipe';

const TOKEN = /[\p{L}\p{N}]+/gu;
const GRID = 10_000;
const MAX_WORDS = 20_000;

type ViewportLike = Readonly<{
	width: number;
	height: number;
	convertToViewportPoint(x: number, y: number): unknown;
}>;

type PdfTextItemLike = Readonly<{
	str: string;
	width: number;
	height: number;
	transform: readonly number[];
}>;

function clampGrid(value: number) {
	return Math.max(0, Math.min(GRID, Math.round(value)));
}

function textItem(value: unknown): PdfTextItemLike | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const item = value as Record<string, unknown>;
	if (
		typeof item.str !== 'string' ||
		item.str.length === 0 ||
		typeof item.width !== 'number' ||
		!Number.isFinite(item.width) ||
		item.width <= 0 ||
		typeof item.height !== 'number' ||
		!Number.isFinite(item.height) ||
		!Array.isArray(item.transform) ||
		item.transform.length !== 6 ||
		item.transform.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
	) {
		return null;
	}
	return {
		str: item.str,
		width: item.width,
		height: item.height,
		transform: item.transform as number[]
	};
}

function viewportPoint(
	viewport: ViewportLike,
	x: number,
	y: number
): readonly [number, number] | null {
	const point = viewport.convertToViewportPoint(x, y);
	if (
		!Array.isArray(point) ||
		point.length < 2 ||
		typeof point[0] !== 'number' ||
		!Number.isFinite(point[0]) ||
		typeof point[1] !== 'number' ||
		!Number.isFinite(point[1])
	) {
		return null;
	}
	return [point[0], point[1]];
}

function normalizedBox(
	viewport: ViewportLike,
	points: readonly (readonly [number, number])[]
): Omit<WordGeometry, 'text'> | null {
	if (
		!Number.isFinite(viewport.width) ||
		viewport.width <= 0 ||
		!Number.isFinite(viewport.height) ||
		viewport.height <= 0
	) {
		return null;
	}
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	const left = clampGrid((Math.min(...xs) / viewport.width) * GRID);
	const top = clampGrid((Math.min(...ys) / viewport.height) * GRID);
	const right = clampGrid((Math.max(...xs) / viewport.width) * GRID);
	const bottom = clampGrid((Math.max(...ys) / viewport.height) * GRID);
	if (right <= left || bottom <= top) return null;
	return { left, top, right, bottom };
}

export function pdfTextItemsToWordGeometry(
	items: readonly unknown[],
	viewport: ViewportLike
): readonly WordGeometry[] {
	const geometry: WordGeometry[] = [];
	for (const candidate of items) {
		if (geometry.length >= MAX_WORDS) break;
		const item = textItem(candidate);
		if (!item) continue;
		const matches = [...item.str.matchAll(TOKEN)];
		if (matches.length === 0) continue;

		const [a, b, , , e, f] = item.transform;
		const directionLength = Math.hypot(a!, b!);
		if (!Number.isFinite(directionLength) || directionLength <= 0) continue;
		const directionX = a! / directionLength;
		const directionY = b! / directionLength;
		const height = item.height > 0 ? item.height : directionLength;
		const normalX = -directionY;
		const normalY = directionX;

		for (const match of matches) {
			if (geometry.length >= MAX_WORDS) break;
			const text = match[0];
			const startIndex = match.index ?? 0;
			const startFraction = startIndex / item.str.length;
			const endFraction = (startIndex + text.length) / item.str.length;
			const startX = e! + directionX * item.width * startFraction;
			const startY = f! + directionY * item.width * startFraction;
			const endX = e! + directionX * item.width * endFraction;
			const endY = f! + directionY * item.width * endFraction;
			const topStartX = startX + normalX * height;
			const topStartY = startY + normalY * height;
			const topEndX = endX + normalX * height;
			const topEndY = endY + normalY * height;
			const bottomStart = viewportPoint(viewport, startX, startY);
			const bottomEnd = viewportPoint(viewport, endX, endY);
			const topStart = viewportPoint(viewport, topStartX, topStartY);
			const topEnd = viewportPoint(viewport, topEndX, topEndY);
			if (!bottomStart || !bottomEnd || !topStart || !topEnd) continue;
			const box = normalizedBox(viewport, [bottomStart, bottomEnd, topStart, topEnd]);
			if (box) geometry.push(Object.freeze({ text, ...box }));
		}
	}
	return Object.freeze(geometry);
}

export async function extractPdfDocumentWordGeometry(
	pdfDocument: PDFDocumentProxy,
	pageNumber: number
): Promise<readonly WordGeometry[]> {
	if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDocument.numPages) {
		return Object.freeze([]);
	}
	const page = await pdfDocument.getPage(pageNumber);
	try {
		const [textContent, viewport] = await Promise.all([
			page.getTextContent({ includeMarkedContent: false }),
			Promise.resolve(page.getViewport({ scale: 1 }))
		]);
		return pdfTextItemsToWordGeometry(textContent.items, viewport);
	} catch {
		return Object.freeze([]);
	} finally {
		try {
			page.cleanup();
		} catch {
			// Geometry extraction is best-effort and must not break media rendering.
		}
	}
}

export async function extractPdfFileWordGeometry(
	file: File,
	pageNumber: number
): Promise<readonly WordGeometry[]> {
	if (file.type !== 'application/pdf' || file.size < 1) return Object.freeze([]);
	const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
		import('pdfjs-dist'),
		import('pdfjs-dist/build/pdf.worker.min.mjs?url')
	]);
	GlobalWorkerOptions.workerSrc = workerModule.default;
	const bytes = new Uint8Array(await file.arrayBuffer());
	const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
	try {
		const document = await loadingTask.promise;
		try {
			return await extractPdfDocumentWordGeometry(document, pageNumber);
		} finally {
			try {
				document.cleanup();
			} catch {
				// Best-effort cleanup.
			}
		}
	} catch {
		return Object.freeze([]);
	} finally {
		await Promise.resolve(loadingTask.destroy()).catch(() => undefined);
		safelyWipeBytes(bytes);
	}
}
