import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DriveTokenClientLike } from '$lib/drive/browser-upload';
import { recordOcrConsent } from '$lib/services/ocr-consent';
import {
	OcrProcessingError,
	processPageOcr,
	type OcrRunResult
} from '$lib/services/ocr';
import { getSupabaseClient } from '$lib/services/supabase';
import type { Database } from '$lib/types/database';
import type { StagedDrivePdfReference } from './drive-reference';
import {
	inspectDrivePdfDocument,
	type DrivePdfRangeInspection
} from './drive-range-inspector';
import { openDrivePdfRangeDocument } from './drive-range-transport';
import { buildPdfImportPlan, type PdfImportPagePlan } from './import-plan';
import { renderPdfDocumentPage } from './renderer';
import {
	PdfConsentRequiredError,
	parsePdfImportPublication,
	type PdfImportPublication
} from './upload';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MAX_DERIVED_PAGE_BYTES = 12 * 1024 * 1024;

type ReferenceImportClient = SupabaseClient<Database> & DriveTokenClientLike;

type PageProcessResult = Pick<OcrRunResult, 'state'> & { needsReview?: boolean };

export type DrivePdfReferenceImportResult = PdfImportPublication & {
	ocrCompleted: number;
	ocrNeedsReview: number;
	ocrPending: number;
	ocrFailed: number;
};

export interface DrivePdfReferenceImportDependencies {
	currentUserId(): Promise<string>;
	openDocument(input: {
		client: DriveTokenClientLike;
		fileId: string;
		totalBytes: number;
	}): Promise<PDFDocumentProxy>;
	inspectDocument(
		document: PDFDocumentProxy,
		options?: { signal?: AbortSignal }
	): Promise<DrivePdfRangeInspection>;
	recordOcrConsent(version?: number): Promise<void>;
	renderPage(
		document: PDFDocumentProxy,
		pageNumber: number,
		options?: { maxDimension?: number; quality?: number; signal?: AbortSignal }
	): Promise<Blob>;
	upload(path: string, blob: Blob): Promise<void>;
	remove(paths: readonly string[]): Promise<void>;
	finalize(input: {
		documentId: string;
		pages: readonly PdfImportPagePlan[];
		promptVersion: number;
	}): Promise<unknown>;
	processPage(pageId: string, options?: { signal?: AbortSignal }): Promise<PageProcessResult>;
}

export class DrivePdfReferenceImportError extends Error {
	constructor() {
		super('Não foi possível concluir a importação do PDF grande. A referência no Drive foi preservada para nova tentativa.');
		this.name = 'DrivePdfReferenceImportError';
	}
}

function abortError() {
	return new DOMException('Drive PDF import was cancelled', 'AbortError');
}

function validateStagedReference(value: StagedDrivePdfReference) {
	if (
		!UUID.test(value.documentId) ||
		!DRIVE_ID.test(value.driveFileId) ||
		!Number.isSafeInteger(value.sourceSizeBytes) ||
		value.sourceSizeBytes < 1 ||
		value.status !== 'pending_inspection'
	) {
		throw new TypeError('Invalid staged Drive PDF reference');
	}
}

function validatePromptVersion(value: number | undefined) {
	const promptVersion = value ?? 1;
	if (!Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
		throw new TypeError('Invalid OCR prompt version');
	}
	return promptVersion;
}

function imageExtension(blob: Blob) {
	return blob.type === 'image/webp' ? 'webp' : 'jpg';
}

function createDefaultDependencies(client: ReferenceImportClient): DrivePdfReferenceImportDependencies {
	return {
		async currentUserId() {
			const { data, error } = await client.auth.getSession();
			if (error || data.session === null || !UUID.test(data.session.user.id)) {
				throw new Error('authentication_required');
			}
			return data.session.user.id;
		},
		openDocument: openDrivePdfRangeDocument,
		inspectDocument: inspectDrivePdfDocument,
		recordOcrConsent,
		renderPage: renderPdfDocumentPage,
		async upload(path, blob) {
			const { error } = await client.storage.from('documents').upload(path, blob, {
				contentType: blob.type,
				cacheControl: '86400',
				upsert: false
			});
			if (error) throw error;
		},
		async remove(paths) {
			if (paths.length === 0) return;
			await client.storage.from('documents').remove([...paths]);
		},
		async finalize(input) {
			type RpcClient = {
				rpc(
					name: 'finalize_drive_pdf_reference_import',
					args: Record<string, unknown>
				): Promise<{ data: unknown; error: unknown }>;
			};
			const { data, error } = await (client as unknown as RpcClient).rpc(
				'finalize_drive_pdf_reference_import',
				{
					target_document_id: input.documentId,
					page_descriptors: input.pages,
					prompt_version: input.promptVersion
				}
			);
			if (error) throw error;
			return data;
		},
		processPage: (pageId, options) => processPageOcr(pageId, undefined, options)
	};
}

async function processPublishedOcrPages(
	pages: readonly PdfImportPagePlan[],
	dependencies: DrivePdfReferenceImportDependencies,
	signal?: AbortSignal
) {
	const queue = pages.filter((page) => page.needsOcr);
	let complete = 0;
	let needsReview = 0;
	let pending = 0;
	let failed = 0;

	for (let index = 0; index < queue.length; index += 1) {
		const page = queue[index];
		if (!page) continue;
		if (signal?.aborted) {
			pending += queue.length - index;
			break;
		}
		try {
			const result = await dependencies.processPage(page.id, { signal });
			if (result.state === 'complete' || result.state === 'already_complete') {
				if (result.needsReview) needsReview += 1;
				else complete += 1;
			} else {
				pending += 1;
			}
		} catch (error) {
			if (error instanceof OcrProcessingError && !error.retryable) failed += 1;
			else pending += 1;
		}
	}
	return { complete, needsReview, pending, failed };
}

export async function importStagedDrivePdfReference({
	staged,
	consentGranted,
	promptVersion: requestedPromptVersion,
	signal,
	client = getSupabaseClient() as ReferenceImportClient,
	dependencies
}: {
	staged: StagedDrivePdfReference;
	consentGranted: boolean;
	promptVersion?: number;
	signal?: AbortSignal;
	client?: ReferenceImportClient;
	dependencies?: DrivePdfReferenceImportDependencies;
}): Promise<DrivePdfReferenceImportResult> {
	validateStagedReference(staged);
	const promptVersion = validatePromptVersion(requestedPromptVersion);
	if (signal?.aborted) throw abortError();
	const runtime = dependencies ?? createDefaultDependencies(client);
	const uploadedPaths: string[] = [];
	let metadataPublished = false;
	let document: PDFDocumentProxy | null = null;

	try {
		const userId = await runtime.currentUserId();
		if (!UUID.test(userId)) throw new Error('authentication_required');
		if (signal?.aborted) throw abortError();

		document = await runtime.openDocument({
			client,
			fileId: staged.driveFileId,
			totalBytes: staged.sourceSizeBytes
		});
		const inspection = await runtime.inspectDocument(document, { signal });
		if (inspection.pagesNeedingOcr.length > 0) {
			if (!consentGranted) throw new PdfConsentRequiredError();
			await runtime.recordOcrConsent();
		}
		if (signal?.aborted) throw abortError();

		const storageRoot = `${userId}/${staged.documentId}`;
		let pages = buildPdfImportPlan(inspection, storageRoot).map((page) => ({ ...page }));
		const ocrPages = pages.filter((page) => page.needsOcr);

		for (const page of ocrPages) {
			if (signal?.aborted) throw abortError();
			let blob = await runtime.renderPage(document, page.pageNumber, {
				maxDimension: 2400,
				quality: 0.88,
				signal
			});
			if (blob.size > MAX_DERIVED_PAGE_BYTES) {
				blob = await runtime.renderPage(document, page.pageNumber, {
					maxDimension: 1800,
					quality: 0.78,
					signal
				});
			}
			if (blob.size < 1 || !['image/webp', 'image/jpeg'].includes(blob.type)) {
				throw new Error('invalid_derived_page');
			}
			const temporaryImagePath = `${storageRoot}/pages/${page.pageNumber}.${imageExtension(blob)}`;
			await runtime.upload(temporaryImagePath, blob);
			uploadedPaths.push(temporaryImagePath);
			pages = pages.map((candidate) =>
				candidate.id === page.id ? { ...candidate, temporaryImagePath } : candidate
			);
		}

		if (signal?.aborted) throw abortError();
		const publication = parsePdfImportPublication(
			await runtime.finalize({
				documentId: staged.documentId,
				pages: Object.freeze(pages.map((page) => Object.freeze(page))),
				promptVersion
			}),
			staged.documentId
		);
		metadataPublished = true;

		const ocr = await processPublishedOcrPages(pages, runtime, signal);
		return Object.freeze({
			...publication,
			ocrCompleted: ocr.complete,
			ocrNeedsReview: ocr.needsReview,
			ocrPending: ocr.pending,
			ocrFailed: ocr.failed
		});
	} catch (error) {
		if (!metadataPublished && uploadedPaths.length > 0) {
			await runtime.remove(uploadedPaths).catch(() => undefined);
		}
		if (error instanceof PdfConsentRequiredError) throw error;
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new DrivePdfReferenceImportError();
	} finally {
		if (document) await document.destroy().catch(() => undefined);
	}
}
