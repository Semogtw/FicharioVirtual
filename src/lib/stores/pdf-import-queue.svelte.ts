import {
	DuplicatePdfError,
	PdfConsentRequiredError,
	uploadPdf,
	type PdfUploadProgress,
	type UploadedPdf
} from '$lib/pdf/upload';
import { resumeDocumentOcr, type OcrResumeSummary } from '$lib/services/ocr-resume';

export type PdfQueueStatus =
	| 'queued'
	| 'inspecting'
	| 'uploading'
	| 'rendering'
	| 'publishing'
	| 'reading'
	| 'waiting'
	| 'needs_review'
	| 'complete'
	| 'duplicate'
	| 'failed'
	| 'cancelled';

export type PdfQueueItem = {
	id: string;
	file: File;
	notebookId: string | null;
	consentGranted: boolean;
	status: PdfQueueStatus;
	progress: PdfUploadProgress | null;
	result: UploadedPdf | null;
	duplicateDocumentId: string | null;
	error: string | null;
};

export const pdfImportQueue = $state<{ items: PdfQueueItem[] }>({ items: [] });

const controllers = new Map<string, AbortController>();
const queuedFiles = new WeakSet<File>();
let running = false;

function id() {
	return (
		globalThis.crypto?.randomUUID?.() ?? `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`
	);
}

function message(error: unknown) {
	return error instanceof Error ? error.message : 'Não foi possível importar este PDF.';
}

export function pdfQueueStatusFromResult(result: UploadedPdf): PdfQueueStatus {
	if (result.ocrPending > 0) return 'waiting';
	if (result.ocrFailed > 0) return 'failed';
	if (result.reviewPageCount > 0 || result.ocrNeedsReview > 0) return 'needs_review';
	return 'complete';
}

export function mergePdfOcrResumeSummary(
	result: UploadedPdf,
	summary: OcrResumeSummary
): UploadedPdf {
	let remaining = result.ocrPending;
	const completed = Math.min(summary.completed, remaining);
	remaining -= completed;
	const needsReview = Math.min(summary.needsReview, remaining);
	remaining -= needsReview;
	const failed = Math.min(summary.failed, remaining);
	remaining -= failed;
	return Object.freeze({
		...result,
		ocrCompleted: result.ocrCompleted + completed,
		ocrNeedsReview: result.ocrNeedsReview + needsReview,
		ocrPending: remaining,
		ocrFailed: result.ocrFailed + failed
	});
}

function phaseStatus(progress: PdfUploadProgress): PdfQueueStatus {
	return progress.phase;
}

async function processItem(item: PdfQueueItem) {
	const controller = new AbortController();
	controllers.set(item.id, controller);
	item.error = null;
	item.result = null;
	item.duplicateDocumentId = null;
	item.status = 'inspecting';
	try {
		item.result = await uploadPdf(item.file, {
			notebookId: item.notebookId,
			consentGranted: item.consentGranted,
			signal: controller.signal,
			onProgress(progress) {
				item.progress = progress;
				item.status = phaseStatus(progress);
			}
		});
		item.status = pdfQueueStatusFromResult(item.result);
		if (item.result.ocrFailed > 0) {
			item.error = `${item.result.ocrFailed} página(s) não puderam ser lidas automaticamente.`;
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			item.status = 'cancelled';
			item.error = null;
		} else if (error instanceof DuplicatePdfError) {
			item.status = 'duplicate';
			item.duplicateDocumentId = error.documentId;
			item.error = error.message;
		} else if (error instanceof PdfConsentRequiredError) {
			item.status = 'failed';
			item.error = error.message;
		} else {
			item.status = 'failed';
			item.error = message(error);
		}
	} finally {
		controllers.delete(item.id);
		item.progress = null;
	}
}

async function pump() {
	if (running) return;
	running = true;
	try {
		while (true) {
			const next = pdfImportQueue.items.find((item) => item.status === 'queued');
			if (!next) return;
			await processItem(next);
		}
	} finally {
		running = false;
	}
}

export function addPdfs(
	files: readonly File[],
	options: { notebookId?: string | null; consentGranted: boolean }
) {
	for (const file of files) {
		if (queuedFiles.has(file)) continue;
		queuedFiles.add(file);
		pdfImportQueue.items.push({
			id: id(),
			file,
			notebookId: options.notebookId ?? null,
			consentGranted: options.consentGranted,
			status: 'queued',
			progress: null,
			result: null,
			duplicateDocumentId: null,
			error: null
		});
	}
	void pump();
}

export function cancelPdfImport(itemId: string) {
	controllers.get(itemId)?.abort();
	const item = pdfImportQueue.items.find((candidate) => candidate.id === itemId);
	if (item?.status === 'queued') item.status = 'cancelled';
}

export async function retryPdfImport(itemId: string) {
	const item = pdfImportQueue.items.find((candidate) => candidate.id === itemId);
	if (!item || !['failed', 'cancelled', 'waiting'].includes(item.status)) return;
	item.error = null;
	if (item.result) {
		const controller = new AbortController();
		controllers.set(item.id, controller);
		item.status = 'reading';
		try {
			const summary = await resumeDocumentOcr(item.result.documentId, {
				signal: controller.signal
			});
			item.result = mergePdfOcrResumeSummary(item.result, summary);
			item.status = pdfQueueStatusFromResult(item.result);
			if (item.result.ocrFailed > 0) {
				item.error = `${item.result.ocrFailed} página(s) não puderam ser lidas automaticamente.`;
			}
		} catch (error) {
			item.status = 'waiting';
			item.error = message(error);
		} finally {
			if (controllers.get(item.id) === controller) controllers.delete(item.id);
		}
		return;
	}
	item.status = 'queued';
	void pump();
}

export function removePdfImport(itemId: string) {
	cancelPdfImport(itemId);
	const index = pdfImportQueue.items.findIndex((item) => item.id === itemId);
	if (index < 0) return;
	const [item] = pdfImportQueue.items.splice(index, 1);
	if (item) queuedFiles.delete(item.file);
}

export function clearFinishedPdfImports() {
	for (const item of [...pdfImportQueue.items]) {
		if (['complete', 'needs_review', 'duplicate', 'cancelled'].includes(item.status)) {
			removePdfImport(item.id);
		}
	}
}
