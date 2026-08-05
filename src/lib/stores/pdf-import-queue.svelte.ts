import { runBrowserExclusive } from '$lib/import/browser-exclusive';
import {
	publishImportUpdate,
	subscribeImportUpdates,
	type ImportBroadcastUpdate
} from '$lib/import/import-broadcast';
import { RecentImportCompletions } from '$lib/import/recent-import-completions';
import {
	deleteStoredPdfImport,
	listStoredPdfImports,
	saveStoredPdfImport,
	type PdfResumeStore,
	type StoredPdfImportRecord
} from '$lib/pdf/resume-store';
import {
	DuplicatePdfError,
	PdfConsentRequiredError,
	uploadPdf,
	type PdfUploadProgress,
	type UploadedPdf
} from '$lib/pdf/upload';
import {
	createImportSession,
	listImportSessionsByResumeKeys,
	updateImportSession
} from '$lib/services/import-sessions';
import { resumeDocumentOcr, type OcrResumeSummary } from '$lib/services/ocr-resume';
import { sessionState } from '$lib/stores/session.svelte';

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
	userId: string;
	sessionId: string | null;
	resumeKey: string;
	file: File;
	notebookId: string | null;
	consentGranted: boolean;
	status: PdfQueueStatus;
	progress: PdfUploadProgress | null;
	inspected: boolean;
	uploaded: boolean;
	published: boolean;
	result: UploadedPdf | null;
	duplicateDocumentId: string | null;
	error: string | null;
};

export const pdfImportQueue = $state<{ items: PdfQueueItem[] }>({ items: [] });

const IMPORT_LOCK_RETRY_MS = 1_000;
const controllers = new Map<string, AbortController>();
const queuedFiles = new WeakSet<File>();
const persistenceChains = new Map<string, Promise<void>>();
const itemStores = new Map<string, PdfResumeStore>();
const restoringUsers = new Set<string>();
const completedElsewhere = new WeakSet<PdfQueueItem>();
const completedBeforeRestore = new RecentImportCompletions();
let running = false;
let lockRetryTimer: ReturnType<typeof setTimeout> | null = null;

function id(prefix = 'pdf') {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
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

function terminalStatus(item: PdfQueueItem) {
	return ['complete', 'needs_review', 'duplicate', 'cancelled'].includes(item.status);
}

function storedStatus(item: PdfQueueItem): StoredPdfImportRecord['status'] {
	switch (item.status) {
		case 'complete':
		case 'needs_review':
		case 'duplicate':
		case 'cancelled':
			return 'cancelled';
		default:
			return item.status;
	}
}

function storedRecord(item: PdfQueueItem): StoredPdfImportRecord {
	return {
		version: 1,
		id: item.id,
		userId: item.userId,
		sessionId: item.sessionId,
		resumeKey: item.resumeKey,
		file: item.file,
		notebookId: item.notebookId,
		consentGranted: item.consentGranted,
		status: storedStatus(item),
		inspected: item.inspected,
		uploaded: item.uploaded,
		published: item.published,
		error: item.error?.slice(0, 500) ?? null,
		updatedAt: new Date().toISOString()
	};
}

async function saveLocalItem(item: PdfQueueItem, store?: PdfResumeStore) {
	if (store) await saveStoredPdfImport(storedRecord(item), store);
	else await saveStoredPdfImport(storedRecord(item));
}

async function deleteLocalItem(item: PdfQueueItem, store?: PdfResumeStore) {
	if (store) await deleteStoredPdfImport(item.id, store);
	else await deleteStoredPdfImport(item.id);
}

function remoteStatus(item: PdfQueueItem) {
	if (item.published) return 'completed' as const;
	if (item.status === 'queued') return 'draft' as const;
	if (item.status === 'inspecting') return 'preparing' as const;
	if (['uploading', 'rendering', 'publishing'].includes(item.status)) return 'uploading' as const;
	if (item.status === 'failed') return 'failed' as const;
	if (item.status === 'cancelled' || item.status === 'duplicate') return 'cancelled' as const;
	return 'processing' as const;
}

async function synchronizeItem(item: PdfQueueItem) {
	const store = itemStores.get(item.id);
	if (completedElsewhere.has(item)) {
		try {
			await deleteLocalItem(item, store);
		} catch {
			// The winning tab already owns the terminal remote state.
		}
		return;
	}
	if (!item.published && !terminalStatus(item)) {
		try {
			await saveLocalItem(item, store);
		} catch {
			// Remote progress remains available when local persistence is unavailable.
		}
	}

	try {
		if (item.sessionId === null) {
			const session = await createImportSession({ localResumeKey: item.resumeKey, totalItems: 1 });
			if (session.userId !== item.userId) return;
			item.sessionId = session.id;
			if (!item.published && !terminalStatus(item)) {
				try {
					await saveLocalItem(item, store);
				} catch {
					// The remote session remains idempotent without local persistence.
				}
			}
		}

		const sessionId = item.sessionId;
		if (sessionId === null || completedElsewhere.has(item)) return;
		const status = remoteStatus(item);
		await updateImportSession(sessionId, {
			status,
			totalItems: 1,
			preparedItems: item.inspected ? 1 : 0,
			uploadedItems: item.uploaded ? 1 : 0,
			completedItems: item.published ? 1 : 0,
			lastErrorCode: item.status === 'failed' ? 'pdf_import_failed' : null,
			finishedAt: status === 'completed' || status === 'cancelled' ? new Date().toISOString() : null
		});
	} catch {
		// A later transition or app opening retries the idempotent session update.
	}

	if (item.published || terminalStatus(item)) {
		try {
			await deleteLocalItem(item, store);
		} catch {
			// A later cleanup pass can remove the local record.
		}
	}
	publishImportUpdate({ type: 'pdf-import-updated', id: item.id, status: item.status });
}

function persistItem(item: PdfQueueItem) {
	const previous = persistenceChains.get(item.id) ?? Promise.resolve();
	const next = previous
		.catch(() => undefined)
		.then(() => synchronizeItem(item))
		.finally(() => {
			if (persistenceChains.get(item.id) === next) persistenceChains.delete(item.id);
		});
	persistenceChains.set(item.id, next);
	return next;
}

async function withImportLock(item: PdfQueueItem, operation: () => Promise<void>) {
	return runBrowserExclusive(`fichario-import-${item.resumeKey}`, operation);
}

async function processItem(item: PdfQueueItem) {
	const controller = new AbortController();
	controllers.set(item.id, controller);
	item.error = null;
	item.result = null;
	item.duplicateDocumentId = null;
	item.status = 'inspecting';
	void persistItem(item);
	try {
		item.result = await uploadPdf(item.file, {
			notebookId: item.notebookId,
			consentGranted: item.consentGranted,
			signal: controller.signal,
			onProgress(progress) {
				item.progress = progress;
				item.status = phaseStatus(progress);
				if (progress.phase === 'inspecting' && progress.completed === progress.total) {
					item.inspected = true;
				}
				if (progress.phase === 'uploading' && progress.completed === progress.total) {
					item.uploaded = true;
				}
				if (progress.phase === 'publishing' && progress.completed === progress.total) {
					item.published = true;
				}
				void persistItem(item);
			}
		});
		item.published = true;
		item.status = pdfQueueStatusFromResult(item.result);
		if (item.result.ocrFailed > 0) {
			item.error = `${item.result.ocrFailed} página(s) não puderam ser lidas automaticamente.`;
		}
		void persistItem(item);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			item.status = item.published ? 'waiting' : 'cancelled';
			item.error = item.published
				? 'O PDF já foi salvo; as leituras pendentes continuarão automaticamente.'
				: null;
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
		void persistItem(item);
	} finally {
		controllers.delete(item.id);
		item.progress = null;
	}
}

function processItemWithLock(item: PdfQueueItem) {
	return withImportLock(item, () => processItem(item));
}

function clearPumpRetry() {
	if (lockRetryTimer === null) return;
	clearTimeout(lockRetryTimer);
	lockRetryTimer = null;
}

function discardCompletedElsewhere(itemId: string) {
	const index = pdfImportQueue.items.findIndex((item) => item.id === itemId);
	if (index < 0) return;
	const [item] = pdfImportQueue.items.splice(index, 1);
	if (!item) return;
	completedElsewhere.add(item);
	controllers.get(item.id)?.abort();
	queuedFiles.delete(item.file);
	if (!pdfImportQueue.items.some((candidate) => candidate.status === 'queued')) {
		clearPumpRetry();
	}
	void persistItem(item).finally(() => {
		itemStores.delete(item.id);
	});
}

function handleImportUpdate(update: ImportBroadcastUpdate) {
	if (
		update.type === 'pdf-import-updated' &&
		['complete', 'needs_review', 'duplicate', 'cancelled'].includes(update.status)
	) {
		completedBeforeRestore.remember(update.id);
		discardCompletedElsewhere(update.id);
	}
}

subscribeImportUpdates(handleImportUpdate);

function schedulePumpRetry() {
	if (lockRetryTimer !== null) return;
	lockRetryTimer = setTimeout(() => {
		lockRetryTimer = null;
		void pump();
	}, IMPORT_LOCK_RETRY_MS);
}

async function pump() {
	if (running) return;
	clearPumpRetry();
	running = true;
	try {
		while (true) {
			const next = pdfImportQueue.items.find((item) => item.status === 'queued');
			if (!next) return;
			const acquired = await processItemWithLock(next);
			if (!acquired) {
				schedulePumpRetry();
				return;
			}
		}
	} finally {
		running = false;
	}
}

export function addPdfs(
	files: readonly File[],
	options: { notebookId?: string | null; consentGranted: boolean }
) {
	const userId = sessionState.user?.id;
	if (!userId) return;
	for (const file of files) {
		if (queuedFiles.has(file)) continue;
		queuedFiles.add(file);
		const item: PdfQueueItem = {
			id: id(),
			userId,
			sessionId: null,
			resumeKey: id('resume'),
			file,
			notebookId: options.notebookId ?? null,
			consentGranted: options.consentGranted,
			status: 'queued',
			progress: null,
			inspected: false,
			uploaded: false,
			published: false,
			result: null,
			duplicateDocumentId: null,
			error: null
		};
		pdfImportQueue.items.push(item);
		void persistItem(item).then(() => pump());
	}
}

export function cancelPdfImport(itemId: string) {
	controllers.get(itemId)?.abort();
	const item = pdfImportQueue.items.find((candidate) => candidate.id === itemId);
	if (item?.status === 'queued') {
		item.status = 'cancelled';
		void persistItem(item);
		if (!pdfImportQueue.items.some((candidate) => candidate.status === 'queued')) {
			clearPumpRetry();
		}
	}
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
			if (error instanceof DOMException && error.name === 'AbortError') {
				item.status = 'cancelled';
				item.error = null;
			} else {
				item.status = 'waiting';
				item.error = message(error);
			}
		} finally {
			if (controllers.get(item.id) === controller) controllers.delete(item.id);
			void persistItem(item);
		}
		return;
	}
	item.status = 'queued';
	void persistItem(item);
	void pump();
}

export function removePdfImport(itemId: string) {
	cancelPdfImport(itemId);
	const index = pdfImportQueue.items.findIndex((item) => item.id === itemId);
	if (index < 0) return;
	const [item] = pdfImportQueue.items.splice(index, 1);
	if (!item) return;
	if (!item.published && !terminalStatus(item)) item.status = 'cancelled';
	void persistItem(item).finally(() => itemStores.delete(item.id));
	queuedFiles.delete(item.file);
	if (!pdfImportQueue.items.some((candidate) => candidate.status === 'queued')) {
		clearPumpRetry();
	}
}

export function clearFinishedPdfImports() {
	for (const item of [...pdfImportQueue.items]) {
		if (['complete', 'needs_review', 'duplicate', 'cancelled'].includes(item.status)) {
			removePdfImport(item.id);
		}
	}
}

export async function restorePdfImports(userId: string, store?: PdfResumeStore) {
	if (restoringUsers.has(userId)) return;
	restoringUsers.add(userId);
	try {
		const records = store
			? await listStoredPdfImports(userId, store)
			: await listStoredPdfImports(userId);
		const remoteSessions = await listImportSessionsByResumeKeys(
			userId,
			records.map((record) => record.resumeKey)
		).catch(() => []);
		const sessionsByKey = new Map(
			remoteSessions
				.filter((session) => session.localResumeKey !== null)
				.map((session) => [session.localResumeKey as string, session])
		);
		for (const record of records) {
			if (completedBeforeRestore.has(record.id)) {
				try {
					if (store) await deleteStoredPdfImport(record.id, store);
					else await deleteStoredPdfImport(record.id);
					completedBeforeRestore.forget(record.id);
				} catch {
					// Keep the tombstone so a later restoration cannot revive the stale record.
				}
				continue;
			}
			const remoteSession = sessionsByKey.get(record.resumeKey);
			if (remoteSession?.status === 'completed' || remoteSession?.status === 'cancelled') {
				try {
					if (store) await deleteStoredPdfImport(record.id, store);
					else await deleteStoredPdfImport(record.id);
				} catch {
					// A future restoration can retry deletion without re-uploading in this session.
				}
				continue;
			}
			if (record.published || pdfImportQueue.items.some((item) => item.id === record.id)) continue;
			const item: PdfQueueItem = {
				id: record.id,
				userId: record.userId,
				sessionId: record.sessionId ?? remoteSession?.id ?? null,
				resumeKey: record.resumeKey,
				file: record.file,
				notebookId: record.notebookId,
				consentGranted: record.consentGranted,
				status: 'queued',
				progress: null,
				inspected: record.inspected,
				uploaded: record.uploaded,
				published: false,
				result: null,
				duplicateDocumentId: null,
				error: record.error
			};
			if (store) itemStores.set(item.id, store);
			queuedFiles.add(item.file);
			pdfImportQueue.items.push(item);
		}
		void pump();
	} finally {
		restoringUsers.delete(userId);
	}
}
