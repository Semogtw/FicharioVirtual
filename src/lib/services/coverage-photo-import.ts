import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { extractTopicCandidatesFromOcr, type OcrTopicExtraction } from '$lib/coverage/topic-import';
import { effectivePageText } from '$lib/domain/page';
import { prepareImage } from '$lib/import/image-client';
import type { PreparedImage } from '$lib/import/image-types';
import { DuplicateImageError, uploadPreparedImage, type UploadedPage } from '$lib/import/upload';
import type { Database, ProcessingStatus } from '$lib/types/database';
import { deleteDocument } from './documents';
import { OcrProcessingError, processPageOcr, type OcrRunResult } from './ocr';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 1_000_000;
const BACKGROUND_OCR_POLL_INTERVAL_MS = 1_500;
const BACKGROUND_OCR_POLL_ATTEMPTS = 100;
const BACKGROUND_OCR_REKICK_EVERY = 8;

const pageSourceSchema = z
	.object({
		id: z.string().regex(UUID),
		page_number: z.number().int().min(1).max(10_000),
		native_text: z.string().max(MAX_TEXT_LENGTH).nullable(),
		ocr_raw_text: z.string().max(MAX_TEXT_LENGTH).nullable(),
		corrected_text: z.string().max(MAX_TEXT_LENGTH).nullable(),
		warnings: z.array(z.unknown()).max(100),
		status: z.enum([
			'pending',
			'processing',
			'ready',
			'retryable',
			'blocked_quota',
			'needs_review',
			'failed'
		])
	})
	.strict();

export type CoveragePhotoImportStage =
	'preparing' | 'uploading' | 'reading' | 'extracting' | 'cleaning_up';

export type CoveragePhotoSourcePage = Readonly<{
	id: string;
	pageNumber: number;
	text: string;
	warningCount: number;
	status: ProcessingStatus;
}>;

export type CoveragePhotoImportResult = OcrTopicExtraction &
	Readonly<{
		reusedExistingDocument: boolean;
		cleanupWarning: boolean;
	}>;

export class CoveragePhotoImportError extends Error {
	readonly code:
		'page_unavailable' | 'ocr_pending' | 'quota_exhausted' | 'ocr_failed' | 'no_topics';

	constructor(code: CoveragePhotoImportError['code'], message?: string) {
		const messages = {
			page_unavailable: 'A leitura terminou, mas o texto extraído não pôde ser carregado.',
			ocr_pending:
				'A leitura automática ficou pendente. Tente novamente quando o serviço estiver disponível.',
			quota_exhausted:
				'A cota diária de leitura automática foi atingida. Tente novamente mais tarde.',
			ocr_failed: 'Não foi possível ler esta foto agora.',
			no_topics: 'A foto foi lida, mas nenhum assunto utilizável foi identificado.'
		} as const;
		super(message ?? messages[code]);
		this.name = 'CoveragePhotoImportError';
		this.code = code;
	}
}

export interface CoveragePhotoImportDependencies {
	prepare(file: File, signal?: AbortSignal): Promise<PreparedImage>;
	upload(prepared: PreparedImage, signal?: AbortSignal): Promise<UploadedPage>;
	process(pageId: string, signal?: AbortSignal): Promise<OcrRunResult>;
	loadPage(pageId: string): Promise<CoveragePhotoSourcePage | null>;
	loadFirstPage(documentId: string): Promise<CoveragePhotoSourcePage | null>;
	deleteTemporaryDocument(documentId: string): Promise<void>;
	wait(delayMs: number, signal?: AbortSignal): Promise<void>;
}

export type CoveragePhotoImportOptions = Readonly<{
	signal?: AbortSignal;
	onStage?: (stage: CoveragePhotoImportStage) => void;
}>;

function abortError() {
	return new DOMException('Coverage photo import was cancelled', 'AbortError');
}

function wait(delayMs: number, signal?: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortError());
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, delayMs);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function validateId(value: string, label: string) {
	if (!UUID.test(value)) throw new TypeError(`Invalid ${label} identifier`);
	return value;
}

function mapPageSource(data: unknown): CoveragePhotoSourcePage {
	const page = pageSourceSchema.parse(data);
	return Object.freeze({
		id: page.id,
		pageNumber: page.page_number,
		text: effectivePageText({
			correctedText: page.corrected_text,
			nativeText: page.native_text,
			ocrRawText: page.ocr_raw_text
		}),
		warningCount: page.warnings.length,
		status: page.status
	});
}

class SupabaseCoveragePhotoSourceGateway {
	constructor(private readonly client: SupabaseClient<Database>) {}

	async loadPage(pageId: string) {
		const { data, error } = await this.client
			.from('pages')
			.select('id,page_number,native_text,ocr_raw_text,corrected_text,warnings,status')
			.eq('id', validateId(pageId, 'page'))
			.maybeSingle();
		if (error) throw new CoveragePhotoImportError('page_unavailable');
		if (data === null) return null;
		try {
			return mapPageSource(data);
		} catch {
			throw new CoveragePhotoImportError('page_unavailable');
		}
	}

	async loadFirstPage(documentId: string) {
		const { data, error } = await this.client
			.from('pages')
			.select('id,page_number,native_text,ocr_raw_text,corrected_text,warnings,status')
			.eq('document_id', validateId(documentId, 'document'))
			.order('page_number', { ascending: true })
			.limit(1);
		if (error || !Array.isArray(data)) throw new CoveragePhotoImportError('page_unavailable');
		const first = data[0];
		if (!first) return null;
		try {
			return mapPageSource(first);
		} catch {
			throw new CoveragePhotoImportError('page_unavailable');
		}
	}
}

function defaultDependencies(): CoveragePhotoImportDependencies {
	const sourceGateway = new SupabaseCoveragePhotoSourceGateway(getSupabaseClient());
	return {
		prepare: (file, signal) => prepareImage(file, 'high-definition', { signal }),
		upload: (prepared, signal) =>
			uploadPreparedImage({
				prepared,
				title: `Importação temporária de ementa — ${prepared.originalName}`.slice(0, 240),
				notebookId: null,
				signal
			}),
		process: (pageId, signal) => processPageOcr(pageId, undefined, { signal }),
		loadPage: (pageId) => sourceGateway.loadPage(pageId),
		loadFirstPage: (documentId) => sourceGateway.loadFirstPage(documentId),
		deleteTemporaryDocument: (documentId) => deleteDocument(documentId),
		wait
	};
}

function processResultNeedsReview(result: OcrRunResult) {
	return result.state === 'complete' && result.needsReview;
}

function importMessage(error: unknown): never {
	if (error instanceof CoveragePhotoImportError) throw error;
	if (error instanceof DOMException && error.name === 'AbortError') throw error;
	if (error instanceof OcrProcessingError) {
		if (error.code === 'gemini_daily_quota') {
			throw new CoveragePhotoImportError('quota_exhausted', error.message);
		}
		if (error.retryable) throw new CoveragePhotoImportError('ocr_pending', error.message);
		throw new CoveragePhotoImportError('ocr_failed', error.message);
	}
	if (error instanceof Error) throw error;
	throw new CoveragePhotoImportError('ocr_failed');
}

function completedBackgroundPage(page: CoveragePhotoSourcePage | null) {
	if (!page) return null;
	if (page.status === 'blocked_quota') throw new CoveragePhotoImportError('quota_exhausted');
	if (page.status === 'failed') throw new CoveragePhotoImportError('ocr_failed');
	if (page.status !== 'ready' && page.status !== 'needs_review') return null;
	if (!page.text.trim()) throw new CoveragePhotoImportError('page_unavailable');
	return page;
}

async function waitForBackgroundOcr(
	pageId: string,
	dependencies: CoveragePhotoImportDependencies,
	signal?: AbortSignal
) {
	for (let attempt = 0; attempt < BACKGROUND_OCR_POLL_ATTEMPTS; attempt += 1) {
		if (signal?.aborted) throw abortError();
		const completed = completedBackgroundPage(await dependencies.loadPage(pageId));
		if (completed) return completed;
		if (attempt === BACKGROUND_OCR_POLL_ATTEMPTS - 1) break;

		if (attempt > 0 && attempt % BACKGROUND_OCR_REKICK_EVERY === 0) {
			try {
				const result = await dependencies.process(pageId, signal);
				if (result.state === 'complete') {
					const afterKick = completedBackgroundPage(await dependencies.loadPage(pageId));
					if (afterKick) return afterKick;
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') throw error;
				if (!(error instanceof OcrProcessingError) || !error.retryable) importMessage(error);
			}
		}

		await dependencies.wait(BACKGROUND_OCR_POLL_INTERVAL_MS, signal);
	}
	throw new CoveragePhotoImportError('ocr_pending');
}

export async function extractTopicsFromPhotoWithDependencies(
	file: File,
	dependencies: CoveragePhotoImportDependencies,
	options: CoveragePhotoImportOptions = {}
): Promise<CoveragePhotoImportResult> {
	if (!(file instanceof File) || file.size < 1) throw new TypeError('Invalid coverage photo');
	if (options.signal?.aborted) throw abortError();

	let temporaryDocumentId: string | null = null;
	let reusedExistingDocument = false;
	let extraction: OcrTopicExtraction | null = null;
	let cleanupWarning = false;

	try {
		options.onStage?.('preparing');
		const prepared = await dependencies.prepare(file, options.signal);
		if (options.signal?.aborted) throw abortError();

		options.onStage?.('uploading');
		let pageId: string;
		try {
			const uploaded = await dependencies.upload(prepared, options.signal);
			temporaryDocumentId = uploaded.documentId;
			pageId = uploaded.pageId;
		} catch (error) {
			if (!(error instanceof DuplicateImageError)) throw error;
			reusedExistingDocument = true;
			const existingPage = await dependencies.loadFirstPage(error.documentId);
			if (!existingPage) throw new CoveragePhotoImportError('page_unavailable');
			pageId = existingPage.id;
		}

		if (options.signal?.aborted) throw abortError();
		options.onStage?.('reading');
		const runResult = await dependencies.process(pageId, options.signal);
		if (options.signal?.aborted) throw abortError();

		const sourcePage =
			runResult.state === 'complete'
				? await dependencies.loadPage(pageId)
				: await waitForBackgroundOcr(pageId, dependencies, options.signal);
		if (!sourcePage || !sourcePage.text.trim()) {
			throw new CoveragePhotoImportError('page_unavailable');
		}

		options.onStage?.('extracting');
		extraction = extractTopicCandidatesFromOcr(sourcePage.text, {
			pageNeedsReview: processResultNeedsReview(runResult) || sourcePage.status === 'needs_review',
			warningCount: sourcePage.warningCount
		});
		if (extraction.topics.length === 0) throw new CoveragePhotoImportError('no_topics');
	} catch (error) {
		importMessage(error);
	} finally {
		if (temporaryDocumentId !== null) {
			options.onStage?.('cleaning_up');
			try {
				await dependencies.deleteTemporaryDocument(temporaryDocumentId);
			} catch {
				cleanupWarning = true;
			}
		}
	}

	if (extraction === null) throw new CoveragePhotoImportError('ocr_failed');
	return Object.freeze({
		...extraction,
		reusedExistingDocument,
		cleanupWarning
	});
}

export function extractTopicsFromPhoto(
	file: File,
	options: CoveragePhotoImportOptions = {}
): Promise<CoveragePhotoImportResult> {
	return extractTopicsFromPhotoWithDependencies(file, defaultDependencies(), options);
}
