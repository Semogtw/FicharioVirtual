import { kickOcrQueue } from './ocr-background';
import {
	OcrProcessingError,
	processOcrBatch as processOcrBatchForeground,
	processPageOcr as processPageOcrForeground,
	type OcrBatchRunResult,
	type OcrFunctionClient,
	type OcrRunResult
} from './ocr-runtime';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH_PAGES = 100;

function abortError() {
	return new DOMException('OCR request was cancelled', 'AbortError');
}

function validatePageIds(pageIds: readonly string[]) {
	if (
		pageIds.length < 1 ||
		pageIds.length > MAX_BATCH_PAGES ||
		pageIds.some((pageId) => !UUID.test(pageId)) ||
		new Set(pageIds).size !== pageIds.length
	) {
		throw new TypeError('Invalid page identifiers');
	}
}

async function kick(signal?: AbortSignal) {
	if (signal?.aborted) throw abortError();
	try {
		await kickOcrQueue();
	} catch {
		throw new OcrProcessingError(
			'ocr_background_kick_failed',
			true,
			'A leitura ficou na fila e será retomada automaticamente.'
		);
	}
	if (signal?.aborted) throw abortError();
}

export async function processOcrBatch(
	pageIds: readonly string[],
	client?: OcrFunctionClient,
	options: { batchId?: string; signal?: AbortSignal } = {}
): Promise<OcrBatchRunResult> {
	if (client) return processOcrBatchForeground(pageIds, client, options);
	validatePageIds(pageIds);
	if (options.batchId !== undefined && !UUID.test(options.batchId)) {
		throw new TypeError('Invalid OCR batch identifier');
	}
	await kick(options.signal);
	return Object.freeze({
		state: 'partial' as const,
		completedPageIds: Object.freeze([]),
		reviewPageIds: Object.freeze([]),
		pendingPageIds: Object.freeze([...pageIds]),
		failedPageIds: Object.freeze([]),
		splitRequiredPageIds: Object.freeze([]),
		unexpectedResultPageIds: Object.freeze([])
	});
}

export async function processPageOcr(
	pageId: string,
	client?: OcrFunctionClient,
	options: { signal?: AbortSignal } = {}
): Promise<OcrRunResult> {
	if (client) return processPageOcrForeground(pageId, client, options);
	if (!UUID.test(pageId)) throw new TypeError('Invalid page identifier');
	await kick(options.signal);
	return Object.freeze({ state: 'retry_later' as const });
}
