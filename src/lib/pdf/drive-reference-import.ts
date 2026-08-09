import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DriveTokenClientLike } from '$lib/drive/browser-upload';
import { recordOcrConsent } from '$lib/services/ocr-consent';
import {
	OcrProcessingError,
	processOcrBatch as runOcrBatch,
	processPageOcr,
	type OcrBatchRunResult,
	type OcrRunResult
} from '$lib/services/ocr';
import { getSupabaseClient } from '$lib/services/supabase';
import type { Database } from '$lib/types/database';
import type { StagedDrivePdfReference } from './drive-reference';
import {
	acquireDrivePdfReferenceDescriptorLease,
	type DrivePdfReferenceDescriptorLease
} from './drive-reference-descriptor-attempt';
import {
	isDrivePdfReferenceStillFinalizable,
	recoverDrivePdfReferencePublication,
	type DrivePdfReferenceRecoveryClient
} from './drive-reference-publication-recovery';
import {
	DrivePdfReferenceChangedError,
	verifyDrivePdfReferenceIdentity
} from './drive-reference-identity';
import {
	inspectDrivePdfDocument,
	type DrivePdfRangeInspection,
	type DrivePdfRangeInspectionOptions
} from './drive-range-inspector';
import { openDrivePdfRangeDocument, type DrivePdfRangeDocument } from './drive-range-transport';
import { buildPdfImportPlan, type PdfImportPagePlan } from './import-plan';
import { runPdfOcrBatches } from './ocr-batching';
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

export type DrivePdfReferenceImportProgress = Readonly<{
	phase:
		'verifying' | 'opening' | 'inspecting' | 'rendering_ocr' | 'publishing' | 'ocr' | 'complete';
	pageNumber?: number;
	pageCount?: number;
	current?: number;
	total?: number;
}>;

export type DrivePdfReferenceImportResult = PdfImportPublication & {
	ocrCompleted: number;
	ocrNeedsReview: number;
	ocrPending: number;
	ocrFailed: number;
};

export interface DrivePdfReferenceImportDependencies {
	currentUserId(): Promise<string>;
	verifyIdentity(input: {
		client: DriveTokenClientLike;
		documentId: string;
		driveFileId: string;
		sourceSizeBytes: number;
	}): Promise<Readonly<{ driveVersion: string; sourceSizeBytes: number }>>;
	openDocument(input: {
		client: DriveTokenClientLike;
		fileId: string;
		totalBytes: number;
	}): Promise<DrivePdfRangeDocument>;
	inspectDocument(
		document: PDFDocumentProxy,
		options?: DrivePdfRangeInspectionOptions
	): Promise<DrivePdfRangeInspection>;
	recordOcrConsent(version?: number): Promise<void>;
	acquireDescriptorLease?(input: {
		documentId: string;
		expectedPageCount: number;
		client: ReferenceImportClient;
	}): Promise<DrivePdfReferenceDescriptorLease>;
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
	recoverPublication(input: {
		documentId: string;
		pages: readonly PdfImportPagePlan[];
	}): Promise<PdfImportPublication | null>;
	referencePending(documentId: string): Promise<boolean>;
	processPage(pageId: string, options?: { signal?: AbortSignal }): Promise<PageProcessResult>;
	processBatch?(
		pageIds: readonly string[],
		options?: { signal?: AbortSignal }
	): Promise<OcrBatchRunResult>;
}

export class DrivePdfReferenceImportError extends Error {
	constructor() {
		super(
			'Não foi possível concluir a importação do PDF grande. A referência no Drive foi preservada para nova tentativa.'
		);
		this.name = 'DrivePdfReferenceImportError';
	}
}

function abortError() {
	return new DOMException('Drive PDF import was cancelled', 'AbortError');
}

function safelyReportProgress(
	onProgress: ((progress: DrivePdfReferenceImportProgress) => void) | undefined,
	progress: DrivePdfReferenceImportProgress
) {
	try {
		onProgress?.(Object.freeze(progress));
	} catch {
		// Progress observers are UI-only and must never alter import semantics.
	}
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

function createDefaultDependencies(
	client: ReferenceImportClient
): DrivePdfReferenceImportDependencies {
	return {
		async currentUserId() {
			const { data, error } = await client.auth.getSession();
			if (error || data.session === null || !UUID.test(data.session.user.id)) {
				throw new Error('authentication_required');
			}
			return data.session.user.id;
		},
		verifyIdentity: (input) =>
			verifyDrivePdfReferenceIdentity({
				...input,
				client: input.client as Parameters<typeof verifyDrivePdfReferenceIdentity>[0]['client']
			}),
		openDocument: openDrivePdfRangeDocument,
		inspectDocument: inspectDrivePdfDocument,
		recordOcrConsent,
		acquireDescriptorLease: ({ documentId, expectedPageCount }) =>
			acquireDrivePdfReferenceDescriptorLease({
				documentId,
				expectedPageCount,
				client: client as unknown as Parameters<
					typeof acquireDrivePdfReferenceDescriptorLease
				>[0]['client']
			}),
		renderPage: renderPdfDocumentPage,
		async upload(path, blob) {
			const { error } = await client.storage.from('documents').upload(path, blob, {
				contentType: blob.type,
				cacheControl: '86400',
				upsert: true
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
		recoverPublication: ({ documentId, pages }) =>
			recoverDrivePdfReferencePublication({
				client: client as unknown as DrivePdfReferenceRecoveryClient,
				documentId,
				pages
			}),
		referencePending: (documentId) =>
			isDrivePdfReferenceStillFinalizable({
				client: client as unknown as DrivePdfReferenceRecoveryClient,
				documentId
			}),
		processPage: (pageId, options) => processPageOcr(pageId, undefined, options),
		processBatch: (pageIds, options) => runOcrBatch(pageIds, undefined, options)
	};
}

async function processPublishedOcrPages(
	pages: readonly PdfImportPagePlan[],
	renderedSizes: ReadonlyMap<string, number>,
	dependencies: DrivePdfReferenceImportDependencies,
	onProgress?: (progress: DrivePdfReferenceImportProgress) => void,
	signal?: AbortSignal
) {
	const queue = pages.filter((page) => page.needsOcr);
	const processBatch = dependencies.processBatch;
	if (processBatch && queue.length > 0) {
		return runPdfOcrBatches({
			pages: queue.map((page) => {
				const derivedBytes = renderedSizes.get(page.id);
				if (!Number.isSafeInteger(derivedBytes) || !derivedBytes || derivedBytes < 1) {
					throw new Error('missing_derived_page_size');
				}
				return {
					id: page.id,
					pageNumber: page.pageNumber,
					derivedBytes,
					density: 'normal' as const
				};
			}),
			processBatch: (pageIds) => processBatch(pageIds, { signal }),
			signal,
			onPageFinished: (pageNumber, current, total) =>
				safelyReportProgress(onProgress, { phase: 'ocr', pageNumber, current, total })
		});
	}

	let complete = 0;
	let needsReview = 0;
	let pending = 0;
	let failed = 0;

	for (let index = 0; index < queue.length; index += 1) {
		const page = queue[index];
		if (!page) continue;
		if (signal?.aborted) throw abortError();
		safelyReportProgress(onProgress, {
			phase: 'ocr',
			pageNumber: page.pageNumber,
			current: index + 1,
			total: queue.length
		});
		try {
			const result = await dependencies.processPage(page.id, { signal });
			if (result.state === 'complete' || result.state === 'already_complete') {
				if (result.needsReview) needsReview += 1;
				else complete += 1;
			} else {
				pending += 1;
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
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
	onProgress,
	client = getSupabaseClient() as ReferenceImportClient,
	dependencies
}: {
	staged: StagedDrivePdfReference;
	consentGranted: boolean;
	promptVersion?: number;
	signal?: AbortSignal;
	onProgress?: (progress: DrivePdfReferenceImportProgress) => void;
	client?: ReferenceImportClient;
	dependencies?: DrivePdfReferenceImportDependencies;
}): Promise<DrivePdfReferenceImportResult> {
	validateStagedReference(staged);
	const promptVersion = validatePromptVersion(requestedPromptVersion);
	if (signal?.aborted) throw abortError();
	const runtime = dependencies ?? createDefaultDependencies(client);
	const uploadedPaths: string[] = [];
	let metadataPublished = false;
	let descriptorLease: DrivePdfReferenceDescriptorLease | null = null;
	let rangeDocument: DrivePdfRangeDocument | null = null;
	let document: PDFDocumentProxy | null = null;

	try {
		const userId = await runtime.currentUserId();
		if (!UUID.test(userId)) throw new Error('authentication_required');
		if (signal?.aborted) throw abortError();

		safelyReportProgress(onProgress, { phase: 'verifying' });
		await runtime.verifyIdentity({
			client,
			documentId: staged.documentId,
			driveFileId: staged.driveFileId,
			sourceSizeBytes: staged.sourceSizeBytes
		});
		if (signal?.aborted) throw abortError();

		safelyReportProgress(onProgress, { phase: 'opening' });
		rangeDocument = await runtime.openDocument({
			client,
			fileId: staged.driveFileId,
			totalBytes: staged.sourceSizeBytes
		});
		document = rangeDocument.document;
		const inspection = await runtime.inspectDocument(document, {
			signal,
			onPage: (pageNumber, pageCount) =>
				safelyReportProgress(onProgress, { phase: 'inspecting', pageNumber, pageCount })
		});
		if (inspection.pagesNeedingOcr.length > 0) {
			if (!consentGranted) throw new PdfConsentRequiredError();
			await runtime.recordOcrConsent();
		}
		if (signal?.aborted) throw abortError();

		const storageRoot = `${userId}/${staged.documentId}`;
		let pages = buildPdfImportPlan(inspection, storageRoot).map((page) => ({ ...page }));
		const renderedSizes = new Map<string, number>();
		const ocrPages = pages.filter((page) => page.needsOcr);

		if (runtime.acquireDescriptorLease) {
			descriptorLease = await runtime.acquireDescriptorLease({
				documentId: staged.documentId,
				expectedPageCount: pages.length,
				client
			});
		}

		for (let index = 0; index < ocrPages.length; index += 1) {
			const page = ocrPages[index];
			if (!page) continue;
			if (signal?.aborted) throw abortError();
			await descriptorLease?.renewIfNeeded();
			safelyReportProgress(onProgress, {
				phase: 'rendering_ocr',
				pageNumber: page.pageNumber,
				current: index + 1,
				total: ocrPages.length
			});
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
			if (
				blob.size < 1 ||
				blob.size > MAX_DERIVED_PAGE_BYTES ||
				!['image/webp', 'image/jpeg'].includes(blob.type)
			) {
				throw new Error('invalid_derived_page');
			}
			const temporaryImagePath = `${storageRoot}/pages/${page.pageNumber}.${imageExtension(blob)}`;
			await descriptorLease?.renew();
			await runtime.upload(temporaryImagePath, blob);
			renderedSizes.set(page.id, blob.size);
			uploadedPaths.push(temporaryImagePath);
			pages = pages.map((candidate) =>
				candidate.id === page.id ? { ...candidate, temporaryImagePath } : candidate
			);
			await descriptorLease?.renewIfNeeded();
		}

		if (signal?.aborted) throw abortError();
		safelyReportProgress(onProgress, { phase: 'publishing' });
		const immutablePages = Object.freeze(pages.map((page) => Object.freeze(page)));
		let publication: PdfImportPublication;
		try {
			const finalized = descriptorLease
				? await descriptorLease.stageAndFinalize({
						pages: immutablePages,
						promptVersion,
						signal
					})
				: await runtime.finalize({
						documentId: staged.documentId,
						pages: immutablePages,
						promptVersion
					});
			publication = parsePdfImportPublication(finalized, staged.documentId);
		} catch (finalizeError) {
			const recovered = await runtime
				.recoverPublication({ documentId: staged.documentId, pages: immutablePages })
				.catch(() => null);
			if (!recovered) throw finalizeError;
			publication = recovered;
		}
		metadataPublished = true;

		const ocr = await processPublishedOcrPages(pages, renderedSizes, runtime, onProgress, signal);
		if (signal?.aborted) throw abortError();
		safelyReportProgress(onProgress, { phase: 'complete' });
		return Object.freeze({
			...publication,
			ocrCompleted: ocr.complete,
			ocrNeedsReview: ocr.needsReview,
			ocrPending: ocr.pending,
			ocrFailed: ocr.failed
		});
	} catch (error) {
		if (!metadataPublished && descriptorLease) {
			const abandoned = await descriptorLease.abandon().catch(() => false);
			if (abandoned && uploadedPaths.length > 0) {
				await runtime.remove(uploadedPaths).catch(() => undefined);
			}
		} else if (!metadataPublished && uploadedPaths.length > 0) {
			const referencePending = await runtime.referencePending(staged.documentId).catch(() => false);
			if (referencePending) await runtime.remove(uploadedPaths).catch(() => undefined);
		}
		if (error instanceof PdfConsentRequiredError) throw error;
		if (error instanceof DrivePdfReferenceChangedError) throw error;
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new DrivePdfReferenceImportError();
	} finally {
		await rangeDocument?.destroy().catch(() => undefined);
	}
}
