import type { SupabaseClient } from '@supabase/supabase-js';
import { runPdfOcrBatches } from '$lib/pdf/ocr-batching';
import type { Database } from '$lib/types/database';
import {
	OcrProcessingError,
	processOcrBatch,
	processPageOcr,
	type OcrBatchRunResult,
	type OcrRunResult
} from './ocr';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PendingOcrPage = { id: string; pageNumber: number };
export interface OcrResumeGateway {
	recoverStaleJobs(): Promise<void>;
	listPendingPages(documentId: string): Promise<readonly PendingOcrPage[]>;
}
export type OcrResumeSummary = {
	completed: number;
	needsReview: number;
	pending: number;
	failed: number;
};
type OcrProcessor = (pageId: string) => Promise<OcrRunResult>;
type OcrBatchProcessor = (
	pageIds: readonly string[],
	options?: { signal?: AbortSignal }
) => Promise<OcrBatchRunResult>;
export type OcrResumeOptions = {
	signal?: AbortSignal;
	client?: SupabaseClient<Database>;
	batchProcessor?: OcrBatchProcessor;
	sleep?: (milliseconds: number) => Promise<void>;
};

function validId(value: string) {
	if (!UUID.test(value)) throw new TypeError('Invalid document identifier');
	return value;
}

function invalidPendingPages(): never {
	throw new TypeError('Invalid resumable OCR page response');
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

export function parsePendingOcrPages(data: unknown): readonly PendingOcrPage[] {
	if (!Array.isArray(data)) invalidPendingPages();
	const seenIds = new Set<string>();
	const seenPageNumbers = new Set<number>();
	const pages = data.map((row) => {
		if (row === null || typeof row !== 'object' || Array.isArray(row)) invalidPendingPages();
		const record = row as Record<string, unknown>;
		if (!hasExactKeys(record, ['page_id', 'page_number'])) invalidPendingPages();
		const pageId = record.page_id;
		const pageNumber = record.page_number;
		if (
			typeof pageId !== 'string' ||
			!UUID.test(pageId) ||
			typeof pageNumber !== 'number' ||
			!Number.isInteger(pageNumber) ||
			pageNumber < 1 ||
			seenIds.has(pageId) ||
			seenPageNumbers.has(pageNumber)
		) {
			invalidPendingPages();
		}
		seenIds.add(pageId);
		seenPageNumbers.add(pageNumber);
		return Object.freeze({ id: pageId, pageNumber });
	});
	return Object.freeze(pages.sort((left, right) => left.pageNumber - right.pageNumber));
}

async function resumeInBatches(
	pages: readonly PendingOcrPage[],
	processor: OcrBatchProcessor,
	options: Pick<OcrResumeOptions, 'signal' | 'sleep'>
): Promise<OcrResumeSummary> {
	const result = await runPdfOcrBatches({
		pages: pages.map((page) => ({
			id: page.id,
			pageNumber: page.pageNumber,
			derivedBytes: 1,
			density: 'normal'
		})),
		processBatch: (pageIds) => processor(pageIds, { signal: options.signal }),
		signal: options.signal,
		sleep: options.sleep
	});
	return Object.freeze({
		completed: result.complete,
		needsReview: result.needsReview,
		pending: result.pending,
		failed: result.failed
	});
}

async function resumePageByPage(
	pages: readonly PendingOcrPage[],
	processor: OcrProcessor,
	signal?: AbortSignal
): Promise<OcrResumeSummary> {
	let cursor = 0;
	let completed = 0;
	let needsReview = 0;
	let pending = 0;
	let failed = 0;
	let processed = 0;

	async function consume() {
		while (cursor < pages.length) {
			if (signal?.aborted) return;
			const page = pages[cursor++];
			if (!page) return;
			try {
				const result = await processor(page.id);
				if (result.state === 'complete') {
					if (result.needsReview) needsReview += 1;
					else completed += 1;
				} else pending += 1;
			} catch (error) {
				if (error instanceof OcrProcessingError && error.retryable) pending += 1;
				else failed += 1;
			} finally {
				processed += 1;
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(2, pages.length) }, () => consume()));
	pending += pages.length - processed;
	return Object.freeze({ completed, needsReview, pending, failed });
}

export async function resumeDocumentOcrWithGateway(
	documentId: string,
	gateway: OcrResumeGateway,
	processor: OcrProcessor = processPageOcr,
	options: Pick<OcrResumeOptions, 'signal' | 'batchProcessor' | 'sleep'> = {}
): Promise<OcrResumeSummary> {
	const validDocumentId = validId(documentId);
	await gateway.recoverStaleJobs();
	const pages = [...(await gateway.listPendingPages(validDocumentId))];
	return options.batchProcessor
		? resumeInBatches(pages, options.batchProcessor, options)
		: resumePageByPage(pages, processor, options.signal);
}

class SupabaseGateway implements OcrResumeGateway {
	constructor(private readonly client: SupabaseClient<Database>) {}

	async recoverStaleJobs() {
		const { error } = await this.client.rpc('recover_stale_ocr_jobs');
		if (error) throw new Error('Não foi possível recuperar leituras interrompidas.');
	}

	async listPendingPages(documentId: string) {
		const { data, error } = await this.client.rpc('list_resumable_ocr_pages', {
			target_document_id: validId(documentId),
			selection_at: new Date().toISOString()
		});
		if (error) throw new Error('Não foi possível localizar as páginas pendentes.');
		try {
			return parsePendingOcrPages(data);
		} catch {
			throw new Error('Não foi possível localizar as páginas pendentes.');
		}
	}
}

export function resumeDocumentOcr(documentId: string, options: OcrResumeOptions = {}) {
	return resumeDocumentOcrWithGateway(
		documentId,
		new SupabaseGateway(options.client ?? getSupabaseClient()),
		processPageOcr,
		{
			signal: options.signal,
			sleep: options.sleep,
			batchProcessor:
				options.batchProcessor ??
				((pageIds, batchOptions) => processOcrBatch(pageIds, undefined, batchOptions))
		}
	);
}
