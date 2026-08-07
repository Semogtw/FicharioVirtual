import { planOcrBatches, type OcrPageDensity, type PlannedOcrBatch } from '$lib/ocr/batch-planner';
import { OcrProcessingError, type OcrBatchRunResult } from '$lib/services/ocr';

export type PdfOcrBatchPage = {
	id: string;
	pageNumber: number;
	derivedBytes: number;
	density: OcrPageDensity;
};

export type PdfOcrBatchCounts = {
	complete: number;
	needsReview: number;
	pending: number;
	failed: number;
};

export type RunPdfOcrBatchesInput = {
	pages: readonly PdfOcrBatchPage[];
	processBatch(pageIds: readonly string[]): Promise<OcrBatchRunResult>;
	signal?: AbortSignal;
	onPageFinished?: (pageNumber: number, completed: number, total: number) => void;
	sleep?: (milliseconds: number) => Promise<void>;
};

const MAX_SPLITS_PER_PAGE = 8;

function defaultSleep(milliseconds: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function splitCandidates(
	batch: PlannedOcrBatch,
	pages: readonly PdfOcrBatchPage[]
): readonly PlannedOcrBatch[] {
	const totalBytes = pages.reduce((total, page) => total + page.derivedBytes, 0);
	const maxPages = Math.max(1, Math.ceil(pages.length / 2));
	return planOcrBatches(
		pages.map((page) => ({
			pageId: page.id,
			pageNumber: page.pageNumber,
			derivedBytes: page.derivedBytes,
			density: page.density,
			route: batch.route
		})),
		{
			maxPages,
			denseMaxPages: Math.max(1, Math.min(maxPages, Math.ceil(maxPages / 2))),
			maxDerivedBytes: Math.max(1, Math.ceil(totalBytes / 2))
		}
	).map((child) =>
		Object.freeze({
			...child,
			parentKey: batch.key,
			splitDepth: batch.splitDepth + 1
		})
	);
}

export async function runPdfOcrBatches(input: RunPdfOcrBatchesInput): Promise<PdfOcrBatchCounts> {
	if (input.pages.length === 0) {
		return Object.freeze({ complete: 0, needsReview: 0, pending: 0, failed: 0 });
	}
	const pageById = new Map(input.pages.map((page) => [page.id, page] as const));
	const queue = [
		...planOcrBatches(
			input.pages.map((page) => ({
				pageId: page.id,
				pageNumber: page.pageNumber,
				derivedBytes: page.derivedBytes,
				density: page.density,
				route: 'gemini' as const
			}))
		)
	];
	const sleep = input.sleep ?? defaultSleep;
	const finalized = new Set<string>();
	const splitAttempts = new Map<string, number>();
	let complete = 0;
	let needsReview = 0;
	let pending = 0;
	let failed = 0;
	let progress = 0;

	const finish = (pageId: string, outcome: 'complete' | 'review' | 'pending' | 'failed') => {
		if (finalized.has(pageId)) return;
		const page = pageById.get(pageId);
		if (!page) throw new TypeError('OCR batch returned an unknown page');
		finalized.add(pageId);
		if (outcome === 'complete') complete += 1;
		else if (outcome === 'review') needsReview += 1;
		else if (outcome === 'pending') pending += 1;
		else failed += 1;
		progress += 1;
		input.onPageFinished?.(page.pageNumber, progress, input.pages.length);
	};

	while (queue.length > 0 && !input.signal?.aborted) {
		const batch = queue.shift();
		if (!batch) break;
		const pageIds = batch.pages
			.map((page) => page.pageId)
			.filter((pageId) => !finalized.has(pageId));
		if (pageIds.length === 0) continue;
		try {
			const result = await input.processBatch(Object.freeze(pageIds));
			const review = new Set(result.reviewPageIds);
			for (const pageId of result.completedPageIds) {
				finish(pageId, review.has(pageId) ? 'review' : 'complete');
			}
			for (const pageId of result.failedPageIds) finish(pageId, 'failed');

			const splitRequired = new Set(result.splitRequiredPageIds);
			for (const pageId of result.pendingPageIds) {
				if (!splitRequired.has(pageId)) finish(pageId, 'pending');
			}
			if (splitRequired.size === 0) continue;

			const retryPages = [...splitRequired]
				.map((pageId) => pageById.get(pageId))
				.filter((page): page is PdfOcrBatchPage => page !== undefined && !finalized.has(page.id));
			const eligible: PdfOcrBatchPage[] = [];
			for (const page of retryPages) {
				const attempts = (splitAttempts.get(page.id) ?? 0) + 1;
				splitAttempts.set(page.id, attempts);
				if (attempts > MAX_SPLITS_PER_PAGE) finish(page.id, 'pending');
				else eligible.push(page);
			}
			if (eligible.length === 0 || input.signal?.aborted) continue;
			if (eligible.length === 1 && pageIds.length === 1) {
				finish(eligible[0]!.id, 'pending');
				continue;
			}
			await sleep(2_100);
			if (input.signal?.aborted) continue;
			queue.unshift(...splitCandidates(batch, eligible));
		} catch (error) {
			if (input.signal?.aborted) break;
			const permanent = error instanceof OcrProcessingError && !error.retryable;
			for (const pageId of pageIds) finish(pageId, permanent ? 'failed' : 'pending');
		}
	}

	for (const page of input.pages) {
		if (!finalized.has(page.id)) finish(page.id, 'pending');
	}
	return Object.freeze({ complete, needsReview, pending, failed });
}
