import { calculateSha256 } from '$lib/import/hash';
import { processOcrBatch as runOcrBatch, type OcrBatchRunResult } from '$lib/services/ocr';
import type { DocumentStatus } from '$lib/types/database';
import { buildPdfImportPlan, type PdfImportPagePlan } from './import-plan';
import { inspectPdf } from './inspector-client';
import { runPdfOcrBatches, type PdfOcrBatchPage } from './ocr-batching';
import { renderPdfPage } from './renderer';
import type { PdfInspection } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DERIVED_PAGE_BYTES = 12 * 1024 * 1024;

export type PdfImportPublication = {
	documentId: string;
	pageCount: number;
	ocrPageCount: number;
	reviewPageCount: number;
	status: DocumentStatus;
};

export type PdfCreateImportInput = {
	documentId: string;
	notebookId: string | null;
	title: string;
	originalFilename: string;
	originalStoragePath: string;
	sha256: string;
	sourceCreatedAt: string | null;
	pages: readonly PdfImportPagePlan[];
	promptVersion: number;
};

export interface PdfImportGateway {
	currentUserId(): Promise<string>;
	findDuplicate(sha256: string): Promise<string | null>;
	upload(path: string, blob: Blob): Promise<void>;
	remove(paths: readonly string[]): Promise<void>;
	createImport(input: PdfCreateImportInput): Promise<PdfImportPublication>;
}

export type PdfUploadDependencies = {
	inspectPdf(file: File, options?: { signal?: AbortSignal }): Promise<PdfInspection>;
	renderPdfPage(
		file: File,
		pageNumber: number,
		options?: { maxDimension?: number; quality?: number; signal?: AbortSignal }
	): Promise<Blob>;
	calculateSha256(input: Blob | ArrayBuffer | ArrayBufferView): Promise<string>;
	processOcrBatch(
		pageIds: readonly string[],
		options?: { signal?: AbortSignal }
	): Promise<OcrBatchRunResult>;
};

export type PdfUploadOptions = {
	title?: string;
	notebookId?: string | null;
	promptVersion?: number;
	signal?: AbortSignal;
	onProgress?: (progress: PdfUploadProgress) => void;
};

export type PdfUploadProgress = {
	phase: 'inspecting' | 'uploading' | 'rendering' | 'publishing' | 'reading';
	completed: number;
	total: number;
	pageNumber?: number;
};

export type UploadedPdf = PdfImportPublication & {
	inspection: PdfInspection;
	sha256: string;
	storagePath: string;
	ocrCompleted: number;
	ocrNeedsReview: number;
	ocrPending: number;
	ocrFailed: number;
};

export class DuplicatePdfError extends Error {
	readonly documentId: string;

	constructor(documentId: string) {
		super('Este PDF já está no fichário.');
		this.name = 'DuplicatePdfError';
		this.documentId = documentId;
	}
}

export class PdfUploadError extends Error {
	readonly code:
		| 'invalid_pdf'
		| 'not_authenticated'
		| 'duplicate_check_failed'
		| 'upload_failed'
		| 'metadata_failed';

	constructor(code: PdfUploadError['code']) {
		const messages = {
			invalid_pdf: 'Selecione um arquivo PDF válido e não vazio.',
			not_authenticated: 'Entre novamente antes de enviar arquivos.',
			duplicate_check_failed: 'Não foi possível verificar se o PDF já existe.',
			upload_failed: 'Não foi possível enviar o PDF agora.',
			metadata_failed: 'O PDF foi enviado, mas o registro não pôde ser concluído.'
		} as const;
		super(messages[code]);
		this.name = 'PdfUploadError';
		this.code = code;
	}
}

function abortError() {
	return new DOMException('PDF upload was cancelled', 'AbortError');
}

function uuid() {
	const value = globalThis.crypto?.randomUUID?.();
	if (!value) throw new Error('Secure UUID generation is unavailable');
	return value;
}

function titleFromFile(file: File) {
	return (
		file.name
			.replace(/\.pdf$/i, '')
			.trim()
			.slice(0, 240) || 'PDF sem título'
	);
}

function imageExtension(blob: Blob) {
	return blob.type === 'image/webp' ? 'webp' : 'jpg';
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function expectedPublicationStatus(
	pageCount: number,
	ocrPageCount: number,
	reviewPageCount: number
): DocumentStatus {
	if (ocrPageCount === pageCount) return 'processing';
	if (ocrPageCount > 0) return 'partially_ready';
	if (reviewPageCount > 0) return 'needs_review';
	return 'ready';
}

export function parsePdfImportPublication(
	data: unknown,
	expectedDocumentId: string
): PdfImportPublication {
	if (
		!UUID.test(expectedDocumentId) ||
		data === null ||
		typeof data !== 'object' ||
		Array.isArray(data)
	) {
		throw new TypeError('Invalid PDF import publication');
	}
	const value = data as Record<string, unknown>;
	if (
		!hasExactKeys(value, ['documentId', 'pageCount', 'ocrPageCount', 'reviewPageCount', 'status'])
	) {
		throw new TypeError('Invalid PDF import publication');
	}
	const { documentId, pageCount, ocrPageCount, reviewPageCount, status } = value;
	if (
		typeof documentId !== 'string' ||
		!UUID.test(documentId) ||
		documentId !== expectedDocumentId ||
		typeof pageCount !== 'number' ||
		!Number.isInteger(pageCount) ||
		pageCount < 1 ||
		pageCount > 10_000 ||
		typeof ocrPageCount !== 'number' ||
		!Number.isInteger(ocrPageCount) ||
		ocrPageCount < 0 ||
		ocrPageCount > pageCount ||
		typeof reviewPageCount !== 'number' ||
		!Number.isInteger(reviewPageCount) ||
		reviewPageCount < 0 ||
		reviewPageCount + ocrPageCount > pageCount ||
		typeof status !== 'string' ||
		status !== expectedPublicationStatus(pageCount, ocrPageCount, reviewPageCount)
	) {
		throw new TypeError('Invalid PDF import publication');
	}
	return Object.freeze({ documentId, pageCount, ocrPageCount, reviewPageCount, status });
}

function validate(file: File, options: PdfUploadOptions) {
	if (file.type !== 'application/pdf' || file.size < 1) {
		throw new PdfUploadError('invalid_pdf');
	}
	const promptVersion = options.promptVersion ?? 1;
	if (!Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
		throw new TypeError('Invalid OCR prompt version');
	}
	return promptVersion;
}

function pageDensity(pageNumber: number, inspection: PdfInspection): PdfOcrBatchPage['density'] {
	if (
		inspection.layout.pagesWithTables.includes(pageNumber) ||
		inspection.layout.pagesWithColumns.includes(pageNumber) ||
		inspection.ocrReasonsByPage
			.find((entry) => entry.pageNumber === pageNumber)
			?.reasons.some((reason) => /formula|layout|column|table|encoding/i.test(reason))
	) {
		return 'dense';
	}
	return 'normal';
}

async function processOcrPages(
	pages: readonly PdfImportPagePlan[],
	renderedSizes: ReadonlyMap<string, number>,
	inspection: PdfInspection,
	dependencies: PdfUploadDependencies,
	onProgress?: PdfUploadOptions['onProgress'],
	signal?: AbortSignal
) {
	const queue = pages.filter((page) => page.needsOcr);
	if (queue.length === 0) return { complete: 0, needsReview: 0, pending: 0, failed: 0 };
	onProgress?.({ phase: 'reading', completed: 0, total: queue.length });
	return runPdfOcrBatches({
		pages: queue.map((page) => ({
			id: page.id,
			pageNumber: page.pageNumber,
			derivedBytes: renderedSizes.get(page.id) ?? 1,
			density: pageDensity(page.pageNumber, inspection)
		})),
		processBatch: (pageIds) => dependencies.processOcrBatch(pageIds, { signal }),
		signal,
		onPageFinished: (pageNumber, completed, total) =>
			onProgress?.({ phase: 'reading', completed, total, pageNumber })
	});
}

const defaultDependencies: PdfUploadDependencies = {
	inspectPdf,
	renderPdfPage,
	calculateSha256,
	processOcrBatch: (pageIds, options) => runOcrBatch(pageIds, undefined, options)
};

export async function uploadPdfWithGateway(
	file: File,
	options: PdfUploadOptions,
	gateway: PdfImportGateway,
	dependencies: PdfUploadDependencies = defaultDependencies
): Promise<UploadedPdf> {
	const promptVersion = validate(file, options);
	if (options.signal?.aborted) throw abortError();
	options.onProgress?.({ phase: 'inspecting', completed: 0, total: 1 });
	const inspection = await dependencies.inspectPdf(file, { signal: options.signal });
	options.onProgress?.({ phase: 'inspecting', completed: 1, total: 1 });
	if (options.signal?.aborted) throw abortError();

	const [userId, sha256] = await Promise.all([
		gateway.currentUserId(),
		dependencies.calculateSha256(file)
	]);
	const duplicateId = await gateway.findDuplicate(sha256);
	if (duplicateId) throw new DuplicatePdfError(duplicateId);

	const documentId = uuid();
	const storageRoot = `${userId}/${documentId}`;
	const originalStoragePath = `${storageRoot}/original.pdf`;
	let pages = buildPdfImportPlan(inspection, storageRoot).map((page) => ({ ...page }));
	const renderedSizes = new Map<string, number>();
	const uploadedPaths: string[] = [];
	let metadataPublished = false;

	try {
		options.onProgress?.({ phase: 'uploading', completed: 0, total: 1 });
		await gateway.upload(originalStoragePath, file);
		uploadedPaths.push(originalStoragePath);
		options.onProgress?.({ phase: 'uploading', completed: 1, total: 1 });

		const ocrPages = pages.filter((page) => page.needsOcr);
		let rendered = 0;
		for (const page of ocrPages) {
			if (options.signal?.aborted) throw abortError();
			options.onProgress?.({
				phase: 'rendering',
				completed: rendered,
				total: ocrPages.length,
				pageNumber: page.pageNumber
			});
			let blob = await dependencies.renderPdfPage(file, page.pageNumber, {
				maxDimension: 2400,
				quality: 0.88,
				signal: options.signal
			});
			if (blob.size > MAX_DERIVED_PAGE_BYTES) {
				blob = await dependencies.renderPdfPage(file, page.pageNumber, {
					maxDimension: 1800,
					quality: 0.78,
					signal: options.signal
				});
			}
			if (blob.size < 1) throw new PdfUploadError('upload_failed');
			const temporaryImagePath = `${storageRoot}/pages/${page.pageNumber}.${imageExtension(blob)}`;
			await gateway.upload(temporaryImagePath, blob);
			uploadedPaths.push(temporaryImagePath);
			renderedSizes.set(page.id, blob.size);
			pages = pages.map((candidate) =>
				candidate.id === page.id ? { ...candidate, temporaryImagePath } : candidate
			);
			rendered += 1;
			options.onProgress?.({
				phase: 'rendering',
				completed: rendered,
				total: ocrPages.length,
				pageNumber: page.pageNumber
			});
		}

		if (options.signal?.aborted) throw abortError();
		options.onProgress?.({ phase: 'publishing', completed: 0, total: 1 });
		const publication = await gateway.createImport({
			documentId,
			notebookId: options.notebookId ?? null,
			title: options.title?.trim() || inspection.title || titleFromFile(file),
			originalFilename: file.name,
			originalStoragePath,
			sha256,
			sourceCreatedAt: file.lastModified > 0 ? new Date(file.lastModified).toISOString() : null,
			pages: Object.freeze(pages.map((page) => Object.freeze(page))),
			promptVersion
		});
		metadataPublished = true;
		options.onProgress?.({ phase: 'publishing', completed: 1, total: 1 });

		const ocr = await processOcrPages(
			pages,
			renderedSizes,
			inspection,
			dependencies,
			options.onProgress,
			options.signal
		);
		return Object.freeze({
			...publication,
			inspection,
			sha256,
			storagePath: originalStoragePath,
			ocrCompleted: ocr.complete,
			ocrNeedsReview: ocr.needsReview,
			ocrPending: ocr.pending,
			ocrFailed: ocr.failed
		});
	} catch (error) {
		if (!metadataPublished && uploadedPaths.length > 0) {
			await gateway.remove(uploadedPaths).catch(() => undefined);
		}
		throw error;
	}
}

export async function uploadPdf(
	file: File,
	options: PdfUploadOptions
): Promise<UploadedPdf> {
	const { uploadPdfToDrive } = await import('./drive-upload');
	return uploadPdfToDrive(file, options);
}
