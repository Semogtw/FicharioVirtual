import {
	DuplicatePdfError,
	PdfConsentRequiredError,
	uploadPdf,
	type PdfUploadProgress,
	type UploadedPdf
} from '$lib/pdf/upload';
import { resumeDocumentOcr } from '$lib/services/ocr-resume';

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
const fingerprints = new Set<string>();
let running = false;

function id() {
	return (
		globalThis.crypto?.randomUUID?.() ?? `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`
	);
}

function fingerprint(file: File) {
	return `${file.name}:${file.size}:${file.lastModified}`;
}

function message(error: unknown) {
	return error instanceof Error ? error.message : 'Não foi possível importar este PDF.';
}

export function pdfQueueStatusFromResult(result: UploadedPdf): PdfQueueStatus {
	if (result.ocrPending > 0) return 'waiting';
	if (result.reviewPageCount > 0 || result.ocrNeedsReview > 0) return 'needs_review';
	return 'complete';
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
		const key = fingerprint(file);
		if (fingerprints.has(key)) continue;
		fingerprints.add(key);
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
		item.status = 'reading';
		try {
			const summary = await resumeDocumentOcr(item.result.documentId);
			item.result = Object.freeze({
				...item.result,
				ocrCompleted: item.result.ocrCompleted + summary.completed,
				ocrNeedsReview: item.result.ocrNeedsReview + summary.needsReview,
				ocrPending: summary.pending + summary.failed
			});
			item.status = pdfQueueStatusFromResult(item.result);
			if (summary.failed > 0) item.error = 'Algumas páginas ainda não puderam ser retomadas.';
		} catch (error) {
			item.status = 'waiting';
			item.error = message(error);
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
	if (item) fingerprints.delete(fingerprint(item.file));
}

export function clearFinishedPdfImports() {
	for (const item of [...pdfImportQueue.items]) {
		if (['complete', 'needs_review', 'duplicate', 'cancelled'].includes(item.status)) {
			removePdfImport(item.id);
		}
	}
}
