import { parseOcrPayload, type OcrPayload } from './ocr-contract.ts';
import {
	deriveWordGeometryFromLines,
	type OcrWordGeometry
} from './ocr-word-geometry.ts';

export type OcrContentClass =
	| 'unknown'
	| 'book_clean'
	| 'scan_degraded'
	| 'handwriting'
	| 'mixed'
	| 'table_layout'
	| 'math'
	| 'sparse';

export type OcrBatchRequestedPage = {
	pageId: string;
	pageNumber: number;
};

export type OcrBatchPagePayload = OcrPayload &
	OcrBatchRequestedPage & {
		contentClass: OcrContentClass;
		wordGeometry: readonly OcrWordGeometry[];
	};

export type OcrBatchParseOutcome = {
	valid: boolean;
	pages: readonly OcrBatchPagePayload[];
	missingPageIds: readonly string[];
	duplicatePageIds: readonly string[];
	unexpectedPageIds: readonly string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH_PAGES = 100;
const CONTENT_CLASSES = new Set<OcrContentClass>([
	'unknown',
	'book_clean',
	'scan_degraded',
	'handwriting',
	'mixed',
	'table_layout',
	'math',
	'sparse'
]);

function invalidRequest(): never {
	throw new TypeError('Invalid OCR batch request');
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validateRequestedPages(requestedPages: readonly OcrBatchRequestedPage[]) {
	if (requestedPages.length < 1 || requestedPages.length > MAX_BATCH_PAGES) invalidRequest();
	const ids = new Set<string>();
	const numbers = new Set<number>();
	for (const page of requestedPages) {
		if (
			!UUID.test(page.pageId) ||
			!Number.isInteger(page.pageNumber) ||
			page.pageNumber < 1 ||
			page.pageNumber > 1_000_000 ||
			ids.has(page.pageId) ||
			numbers.has(page.pageNumber)
		) {
			invalidRequest();
		}
		ids.add(page.pageId);
		numbers.add(page.pageNumber);
	}
}

function invalidProviderResponse(
	requestedPages: readonly OcrBatchRequestedPage[]
): OcrBatchParseOutcome {
	return Object.freeze({
		valid: false,
		pages: Object.freeze([]),
		missingPageIds: Object.freeze(requestedPages.map((page) => page.pageId)),
		duplicatePageIds: Object.freeze([]),
		unexpectedPageIds: Object.freeze([])
	});
}

export function parseOcrBatchPayload(
	value: string,
	requestedPages: readonly OcrBatchRequestedPage[]
): OcrBatchParseOutcome {
	validateRequestedPages(requestedPages);
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return invalidProviderResponse(requestedPages);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return invalidProviderResponse(requestedPages);
	}
	const root = parsed as Record<string, unknown>;
	if (
		!hasExactKeys(root, ['pages']) ||
		!Array.isArray(root.pages) ||
		root.pages.length > MAX_BATCH_PAGES
	) {
		return invalidProviderResponse(requestedPages);
	}

	const requestedById = new Map(requestedPages.map((page) => [page.pageId, page] as const));
	const counts = new Map<string, number>();
	const unexpected = new Set<string>();
	const parsedById = new Map<string, OcrBatchPagePayload>();

	for (const item of root.pages) {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) {
			return invalidProviderResponse(requestedPages);
		}
		const page = item as Record<string, unknown>;
		if (
			!hasExactKeys(page, [
				'pageId',
				'pageNumber',
				'text',
				'warnings',
				'contentClass',
				'lineGeometry'
			]) ||
			typeof page.pageId !== 'string' ||
			!UUID.test(page.pageId) ||
			typeof page.pageNumber !== 'number' ||
			!Number.isInteger(page.pageNumber) ||
			typeof page.contentClass !== 'string' ||
			!CONTENT_CLASSES.has(page.contentClass as OcrContentClass)
		) {
			return invalidProviderResponse(requestedPages);
		}

		const requested = requestedById.get(page.pageId);
		if (requested && requested.pageNumber !== page.pageNumber) {
			return invalidProviderResponse(requestedPages);
		}
		counts.set(page.pageId, (counts.get(page.pageId) ?? 0) + 1);
		if (!requested) {
			unexpected.add(page.pageId);
			continue;
		}

		let payload: OcrPayload;
		try {
			payload = parseOcrPayload(JSON.stringify({ text: page.text, warnings: page.warnings }));
		} catch {
			return invalidProviderResponse(requestedPages);
		}
		const wordGeometry = deriveWordGeometryFromLines(page.lineGeometry, payload.text);
		parsedById.set(
			page.pageId,
			Object.freeze({
				pageId: page.pageId,
				pageNumber: page.pageNumber,
				contentClass: page.contentClass as OcrContentClass,
				wordGeometry,
				...payload
			})
		);
	}

	const duplicatePageIds = [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([pageId]) => pageId)
		.sort();
	for (const duplicateId of duplicatePageIds) parsedById.delete(duplicateId);

	const missingPageIds = requestedPages
		.filter((page) => !counts.has(page.pageId))
		.map((page) => page.pageId);
	const unexpectedPageIds = [...unexpected].sort();
	const pages = requestedPages.flatMap((page) => {
		const payload = parsedById.get(page.pageId);
		return payload ? [payload] : [];
	});

	return Object.freeze({
		valid:
			missingPageIds.length === 0 &&
			duplicatePageIds.length === 0 &&
			unexpectedPageIds.length === 0 &&
			pages.length === requestedPages.length,
		pages: Object.freeze(pages),
		missingPageIds: Object.freeze(missingPageIds),
		duplicatePageIds: Object.freeze(duplicatePageIds),
		unexpectedPageIds: Object.freeze(unexpectedPageIds)
	});
}
