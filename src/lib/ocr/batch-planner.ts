export type OcrRoute = 'gemini' | 'desktop';
export type OcrPageDensity = 'sparse' | 'normal' | 'dense';

export type OcrBatchPageCandidate = {
	pageId: string;
	pageNumber: number;
	derivedBytes: number;
	density?: OcrPageDensity;
	route?: OcrRoute;
};

export type OcrBatchPlannerLimits = {
	maxPages?: number;
	denseMaxPages?: number;
	maxDerivedBytes?: number;
	maxEstimatedOutputTokens?: number;
};

export type PlannedOcrBatch = {
	key: string;
	parentKey: string | null;
	route: OcrRoute;
	pages: readonly Readonly<Required<OcrBatchPageCandidate>>[];
	derivedBytes: number;
	estimatedOutputTokens: number;
	splitDepth: number;
	oversizedSinglePage: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_PAGES = 28;
const DEFAULT_DENSE_MAX_PAGES = 14;
const DEFAULT_MAX_DERIVED_BYTES = 12 * 1024 * 1024;
const UNKNOWN_DERIVED_BYTES = 1024 * 1024;
// Flash-Lite can return 65,536 tokens. Leave substantial headroom for pages
// whose actual text/geometry is denser than the preflight classification.
const DEFAULT_MAX_ESTIMATED_OUTPUT_TOKENS = 48_000;
const ESTIMATED_OUTPUT_TOKENS: Readonly<Record<OcrPageDensity, number>> = Object.freeze({
	sparse: 900,
	normal: 1_700,
	dense: 3_000
});

function normalizedLimits(limits: OcrBatchPlannerLimits) {
	const maxPages = limits.maxPages ?? DEFAULT_MAX_PAGES;
	const denseMaxPages = limits.denseMaxPages ?? DEFAULT_DENSE_MAX_PAGES;
	const maxDerivedBytes = limits.maxDerivedBytes ?? DEFAULT_MAX_DERIVED_BYTES;
	const maxEstimatedOutputTokens =
		limits.maxEstimatedOutputTokens ?? DEFAULT_MAX_ESTIMATED_OUTPUT_TOKENS;
	if (
		!Number.isInteger(maxPages) ||
		maxPages < 1 ||
		maxPages > 1_000 ||
		!Number.isInteger(denseMaxPages) ||
		denseMaxPages < 1 ||
		denseMaxPages > maxPages ||
		!Number.isInteger(maxDerivedBytes) ||
		maxDerivedBytes < 1 ||
		maxDerivedBytes > 50 * 1024 * 1024 ||
		!Number.isInteger(maxEstimatedOutputTokens) ||
		maxEstimatedOutputTokens < 1_000 ||
		maxEstimatedOutputTokens > 65_536
	) {
		throw new TypeError('Invalid OCR batch limits');
	}
	return Object.freeze({
		maxPages,
		denseMaxPages,
		maxDerivedBytes,
		maxEstimatedOutputTokens
	});
}

function normalizePage(page: OcrBatchPageCandidate) {
	const unknownDerivedSize = page.derivedBytes === 1;
	const requestedDensity = page.density ?? 'normal';
	const density = unknownDerivedSize && requestedDensity === 'normal' ? 'dense' : requestedDensity;
	const route = page.route ?? 'gemini';
	if (
		!UUID.test(page.pageId) ||
		!Number.isInteger(page.pageNumber) ||
		page.pageNumber < 1 ||
		page.pageNumber > 1_000_000 ||
		!Number.isInteger(page.derivedBytes) ||
		page.derivedBytes < 1 ||
		page.derivedBytes > 50 * 1024 * 1024 ||
		!['sparse', 'normal', 'dense'].includes(requestedDensity) ||
		!['gemini', 'desktop'].includes(route)
	) {
		throw new TypeError('Invalid OCR batch page');
	}
	return Object.freeze({
		...page,
		derivedBytes: unknownDerivedSize ? UNKNOWN_DERIVED_BYTES : page.derivedBytes,
		density,
		route
	});
}

function estimatedOutputTokens(page: Readonly<Required<OcrBatchPageCandidate>>) {
	return ESTIMATED_OUTPUT_TOKENS[page.density];
}

function keyFor(
	route: OcrRoute,
	pages: readonly Readonly<Required<OcrBatchPageCandidate>>[],
	depth: number
) {
	const first = pages[0];
	const last = pages.at(-1);
	if (!first || !last) throw new TypeError('OCR batch cannot be empty');
	return `${route}:${first.pageNumber}-${last.pageNumber}:${pages.length}:${depth}`;
}

function createBatch(
	pages: readonly Readonly<Required<OcrBatchPageCandidate>>[],
	route: OcrRoute,
	maxDerivedBytes: number,
	splitDepth = 0,
	parentKey: string | null = null
): PlannedOcrBatch {
	if (pages.length < 1) throw new TypeError('OCR batch cannot be empty');
	const derivedBytes = pages.reduce((total, page) => total + page.derivedBytes, 0);
	const outputTokens = pages.reduce((total, page) => total + estimatedOutputTokens(page), 0);
	return Object.freeze({
		key: keyFor(route, pages, splitDepth),
		parentKey,
		route,
		pages: Object.freeze([...pages]),
		derivedBytes,
		estimatedOutputTokens: outputTokens,
		splitDepth,
		oversizedSinglePage: pages.length === 1 && derivedBytes > maxDerivedBytes
	});
}

export function planOcrBatches(
	candidates: readonly OcrBatchPageCandidate[],
	limits: OcrBatchPlannerLimits = {}
): readonly PlannedOcrBatch[] {
	const resolved = normalizedLimits(limits);
	const pages = candidates
		.map(normalizePage)
		.sort((left, right) => left.pageNumber - right.pageNumber);
	const ids = new Set<string>();
	const numbers = new Set<number>();
	for (const page of pages) {
		if (ids.has(page.pageId)) throw new TypeError('Duplicate OCR page identifier');
		if (numbers.has(page.pageNumber)) throw new TypeError('Duplicate OCR page number');
		ids.add(page.pageId);
		numbers.add(page.pageNumber);
	}

	const batches: PlannedOcrBatch[] = [];
	let current: Readonly<Required<OcrBatchPageCandidate>>[] = [];
	let currentBytes = 0;
	let currentOutputTokens = 0;
	let currentRoute: OcrRoute | null = null;
	let currentContainsDense = false;

	const flush = () => {
		if (current.length === 0 || currentRoute === null) return;
		batches.push(createBatch(current, currentRoute, resolved.maxDerivedBytes));
		current = [];
		currentBytes = 0;
		currentOutputTokens = 0;
		currentRoute = null;
		currentContainsDense = false;
	};

	for (const page of pages) {
		const candidateContainsDense = currentContainsDense || page.density === 'dense';
		const candidatePageLimit = candidateContainsDense ? resolved.denseMaxPages : resolved.maxPages;
		const routeChanged = currentRoute !== null && currentRoute !== page.route;
		const pageLimitReached = current.length > 0 && current.length + 1 > candidatePageLimit;
		const byteLimitReached =
			current.length > 0 && currentBytes + page.derivedBytes > resolved.maxDerivedBytes;
		const outputLimitReached =
			current.length > 0 &&
			currentOutputTokens + estimatedOutputTokens(page) > resolved.maxEstimatedOutputTokens;
		if (routeChanged || pageLimitReached || byteLimitReached || outputLimitReached) flush();

		currentRoute = page.route;
		current.push(page);
		currentBytes += page.derivedBytes;
		currentOutputTokens += estimatedOutputTokens(page);
		currentContainsDense ||= page.density === 'dense';
	}
	flush();
	return Object.freeze(batches);
}

export function bisectOcrBatch(
	batch: PlannedOcrBatch
): readonly [PlannedOcrBatch, PlannedOcrBatch] {
	if (batch.pages.length < 2) throw new TypeError('Cannot split a one-page OCR batch');
	const midpoint = Math.ceil(batch.pages.length / 2);
	const depth = batch.splitDepth + 1;
	const inferredLimit = batch.oversizedSinglePage ? batch.derivedBytes - 1 : batch.derivedBytes;
	return Object.freeze([
		createBatch(batch.pages.slice(0, midpoint), batch.route, inferredLimit, depth, batch.key),
		createBatch(batch.pages.slice(midpoint), batch.route, inferredLimit, depth, batch.key)
	]);
}

export function validateOcrBatchResult(
	requestedPageIds: readonly string[],
	resultPageIds: readonly string[]
): OcrBatchResultIntegrity {
	const requested = new Set(requestedPageIds);
	const observed = new Set<string>();
	const duplicates = new Set<string>();
	const unexpected = new Set<string>();
	for (const pageId of resultPageIds) {
		if (observed.has(pageId)) duplicates.add(pageId);
		observed.add(pageId);
		if (!requested.has(pageId)) unexpected.add(pageId);
	}
	const missing = requestedPageIds.filter((pageId) => !observed.has(pageId));
	const duplicatePageIds = [...duplicates].sort();
	const unexpectedPageIds = [...unexpected].sort();
	return Object.freeze({
		valid: missing.length === 0 && duplicatePageIds.length === 0 && unexpectedPageIds.length === 0,
		missingPageIds: Object.freeze(missing),
		duplicatePageIds: Object.freeze(duplicatePageIds),
		unexpectedPageIds: Object.freeze(unexpectedPageIds)
	});
}
