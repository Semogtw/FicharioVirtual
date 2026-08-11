import { runBrowserExclusive } from '$lib/import/browser-exclusive';
import {
	publishImportUpdate,
	subscribeImportUpdates,
	type ImportBroadcastUpdate
} from '$lib/import/import-broadcast';
import type { ImagePreparationMode } from '$lib/import/image-types';
import { prepareImage } from '$lib/import/image-client';
import { RecentImportCompletions } from '$lib/import/recent-import-completions';
import {
	deleteStoredImageImport,
	listStoredImageImports,
	saveStoredImageImport,
	type ImportResumeStore,
	type StoredImageImportRecord
} from '$lib/import/resume-store';
import { DuplicateImageError, uploadPreparedImage, type UploadedPage } from '$lib/import/upload';
import {
	createImportSession,
	listImportSessionsByResumeKeys,
	updateImportSession
} from '$lib/services/import-sessions';
import { OcrProcessingError, processPageOcr } from '$lib/services/ocr';
import { sessionState } from '$lib/stores/session.svelte';

export type ImportQueueStatus =
	| 'queued'
	| 'preparing'
	| 'uploading'
	| 'reading'
	| 'waiting'
	| 'needs_review'
	| 'complete'
	| 'duplicate'
	| 'failed'
	| 'cancelled';

export type ImportQueueItem = {
	id: string;
	userId: string;
	sessionId: string | null;
	resumeKey: string;
	file: File;
	mode: ImagePreparationMode;
	notebookId: string | null;
	status: ImportQueueStatus;
	previewUrl: string | null;
	preparedBytes: number | null;
	result: UploadedPage | null;
	duplicateDocumentId: string | null;
	error: string | null;
};

export const importQueue = $state<{ items: ImportQueueItem[] }>({ items: [] });

const IMPORT_LOCK_RETRY_MS = 1_000;
const controllers = new Map<string, AbortController>();
const queuedFiles = new WeakSet<File>();
const persistenceChains = new Map<string, Promise<void>>();
const itemStores = new Map<string, ImportResumeStore>();
const restoringUsers = new Set<string>();
const completedElsewhere = new WeakSet<ImportQueueItem>();
const completedBeforeRestore = new RecentImportCompletions();
const importRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function id(prefix = 'import') {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
	);
}

function message(error: unknown) {
	return error instanceof Error ? error.message : 'Não foi possível importar este arquivo.';
}

function appendImportItem(item: ImportQueueItem) {
	importQueue.items.push(item);
	const appended = importQueue.items[importQueue.items.length - 1];
	if (!appended) throw new Error('The image import queue rejected a new item.');
	return appended;
}

function releasePreview(item: ImportQueueItem) {
	if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
	item.previewUrl = null;
}

function abortError() {
	return new DOMException('OCR request was cancelled', 'AbortError');
}

function storedStatus(item: ImportQueueItem): StoredImageImportRecord['status'] {
	switch (item.status) {
		case 'needs_review':
		case 'complete':
		case 'duplicate':
			return 'cancelled';
		default:
			return item.status;
	}
}

function terminalStatus(item: ImportQueueItem) {
	return ['needs_review', 'complete', 'duplicate', 'cancelled'].includes(item.status);
}

function remoteStatus(item: ImportQueueItem) {
	if (item.status === 'queued') return 'draft' as const;
	if (item.status === 'preparing') return 'preparing' as const;
	if (item.status === 'uploading') return 'uploading' as const;
	if (item.status === 'reading') return 'processing' as const;
	if (item.status === 'waiting') return 'paused' as const;
	if (item.status === 'failed') return 'failed' as const;
	if (item.status === 'complete' || item.status === 'needs_review') return 'completed' as const;
	return 'cancelled' as const;
}

function storedRecord(item: ImportQueueItem): StoredImageImportRecord {
	return {
		version: 1,
		id: item.id,
		userId: item.userId,
		sessionId: item.sessionId,
		resumeKey: item.resumeKey,
		file: item.file,
		mode: item.mode,
		notebookId: item.notebookId,
		status: storedStatus(item),
		preparedBytes: item.preparedBytes,
		result: item.result,
		error: item.error?.slice(0, 500) ?? null,
		updatedAt: new Date().toISOString()
	};
}

async function saveLocalItem(item: ImportQueueItem, store?: ImportResumeStore) {
	if (store) await saveStoredImageImport(storedRecord(item), store);
	else await saveStoredImageImport(storedRecord(item));
}

async function deleteLocalItem(item: ImportQueueItem, store?: ImportResumeStore) {
	if (store) await deleteStoredImageImport(item.id, store);
	else await deleteStoredImageImport(item.id);
}

async function synchronizeItem(item: ImportQueueItem) {
	const store = itemStores.get(item.id);
	if (completedElsewhere.has(item)) {
		try {
			await deleteLocalItem(item, store);
		} catch {
			// The winning tab already owns the terminal remote state.
		}
		return;
	}
	if (!terminalStatus(item)) {
		try {
			await saveLocalItem(item, store);
		} catch {
			// Remote progress can still be tracked when this browser does not offer IndexedDB.
		}
	}

	try {
		if (item.sessionId === null) {
			const session = await createImportSession({ localResumeKey: item.resumeKey, totalItems: 1 });
			if (session.userId !== item.userId) return;
			item.sessionId = session.id;
			if (!terminalStatus(item)) {
				try {
					await saveLocalItem(item, store);
				} catch {
					// The remote session remains usable without local persistence.
				}
			}
		}

		const sessionId = item.sessionId;
		if (sessionId === null || completedElsewhere.has(item)) return;
		const completed = item.status === 'complete' || item.status === 'needs_review';
		const status = remoteStatus(item);
		await updateImportSession(sessionId, {
			status,
			totalItems: 1,
			preparedItems: item.preparedBytes !== null || item.result !== null ? 1 : 0,
			uploadedItems: item.result !== null ? 1 : 0,
			completedItems: completed ? 1 : 0,
			lastErrorCode:
				item.status === 'failed'
					? 'import_failed'
					: item.status === 'waiting'
						? 'ocr_pending'
						: null,
			finishedAt: status === 'completed' || status === 'cancelled' ? new Date().toISOString() : null
		});
	} catch {
		// The next state transition or application opening retries the idempotent session update.
	}

	if (terminalStatus(item)) {
		try {
			await deleteLocalItem(item, store);
		} catch {
			// A later cleanup pass can remove the terminal local record.
		}
	}
	publishImportUpdate({ type: 'image-import-updated', id: item.id, status: item.status });
}

function persistItem(item: ImportQueueItem) {
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

async function withImportLock(item: ImportQueueItem, operation: () => Promise<void>) {
	return runBrowserExclusive(`fichario-import-${item.resumeKey}`, operation);
}

function clearImportRetry(itemId: string) {
	const timer = importRetryTimers.get(itemId);
	if (timer === undefined) return;
	clearTimeout(timer);
	importRetryTimers.delete(itemId);
}

function discardCompletedElsewhere(itemId: string) {
	const index = importQueue.items.findIndex((item) => item.id === itemId);
	if (index < 0) return;
	const [item] = importQueue.items.splice(index, 1);
	if (!item) return;
	completedElsewhere.add(item);
	clearImportRetry(item.id);
	controllers.get(item.id)?.abort();
	queuedFiles.delete(item.file);
	releasePreview(item);
	void persistItem(item).finally(() => {
		itemStores.delete(item.id);
	});
}

function handleImportUpdate(update: ImportBroadcastUpdate) {
	if (
		update.type === 'image-import-updated' &&
		['complete', 'needs_review', 'duplicate', 'cancelled'].includes(update.status)
	) {
		completedBeforeRestore.remember(update.id);
		discardCompletedElsewhere(update.id);
	}
}

subscribeImportUpdates(handleImportUpdate);

function scheduleImportRetry(
	item: ImportQueueItem,
	retry: () => void = () => void processItemWithLock(item),
	expectedStatus: ImportQueueStatus = 'queued'
) {
	if (
		importRetryTimers.has(item.id) ||
		!importQueue.items.includes(item) ||
		item.status !== expectedStatus
	) {
		return;
	}
	const timer = setTimeout(() => {
		importRetryTimers.delete(item.id);
		if (importQueue.items.includes(item) && item.status === expectedStatus) retry();
	}, IMPORT_LOCK_RETRY_MS);
	importRetryTimers.set(item.id, timer);
}

async function processOcr(item: ImportQueueItem, signal?: AbortSignal) {
	if (!item.result) throw new Error('A página importada não está disponível para leitura.');
	item.status = 'reading';
	item.error = null;
	void persistItem(item);
	try {
		if (signal?.aborted) throw abortError();
		const result = await processPageOcr(item.result.pageId, undefined, { signal });
		if (signal?.aborted) throw abortError();
		if (result.state === 'complete') {
			item.status = result.needsReview ? 'needs_review' : 'complete';
			void persistItem(item);
			return;
		}
		item.status = 'waiting';
		item.error = 'A leitura ficou pendente e poderá ser retomada sem reenviar o arquivo.';
		void persistItem(item);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		if (error instanceof OcrProcessingError) {
			item.status = error.retryable || error.code === 'gemini_daily_quota' ? 'waiting' : 'failed';
			item.error = error.message;
			void persistItem(item);
			return;
		}
		item.status = 'waiting';
		item.error = message(error);
		void persistItem(item);
	}
}

async function processItem(item: ImportQueueItem) {
	if (['preparing', 'uploading', 'reading'].includes(item.status)) return;
	const controller = new AbortController();
	controllers.set(item.id, controller);
	item.error = null;
	item.result = null;
	item.duplicateDocumentId = null;
	item.status = 'preparing';
	void persistItem(item);

	try {
		if (controller.signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
		const prepared = await prepareImage(item.file, item.mode, { signal: controller.signal });
		releasePreview(item);
		item.previewUrl = URL.createObjectURL(prepared.thumbnail);
		item.preparedBytes = prepared.preparedBytes;
		item.status = 'uploading';
		void persistItem(item);
		item.result = await uploadPreparedImage({
			prepared,
			notebookId: item.notebookId,
			signal: controller.signal
		});
		void persistItem(item);
		if (controller.signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
		await processOcr(item, controller.signal);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			item.status = item.result ? 'waiting' : 'cancelled';
			item.error = item.result
				? 'O arquivo já foi salvo; a leitura pode ser retomada depois.'
				: null;
		} else if (error instanceof DuplicateImageError) {
			item.status = 'duplicate';
			item.duplicateDocumentId = error.documentId;
			item.error = error.message;
		} else {
			item.status = 'failed';
			item.error = message(error);
		}
		void persistItem(item);
	} finally {
		controllers.delete(item.id);
	}
}

async function processItemWithLock(item: ImportQueueItem) {
	const acquired = await withImportLock(item, () => processItem(item));
	if (!acquired) scheduleImportRetry(item);
	return acquired;
}

export function addImages(
	files: readonly File[],
	options: { mode?: ImagePreparationMode; notebookId?: string | null } = {}
) {
	const userId = sessionState.user?.id;
	if (!userId) return;
	const mode = options.mode ?? 'standard';
	for (const file of files) {
		if (queuedFiles.has(file)) continue;
		queuedFiles.add(file);
		const item: ImportQueueItem = {
			id: id(),
			userId,
			sessionId: null,
			resumeKey: id('resume'),
			file,
			mode,
			notebookId: options.notebookId ?? null,
			status: 'queued',
			previewUrl: null,
			preparedBytes: null,
			result: null,
			duplicateDocumentId: null,
			error: null
		};
		const queuedItem = appendImportItem(item);
		void persistItem(queuedItem).then(() => processItemWithLock(queuedItem));
	}
}

export function cancelImport(itemId: string) {
	clearImportRetry(itemId);
	controllers.get(itemId)?.abort();
	const item = importQueue.items.find((candidate) => candidate.id === itemId);
	if (item?.status === 'queued') {
		item.status = 'cancelled';
		void persistItem(item);
	}
}

async function retryOcr(item: ImportQueueItem) {
	const controller = new AbortController();
	controllers.set(item.id, controller);
	try {
		await processOcr(item, controller.signal);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			if (importQueue.items.includes(item)) {
				item.status = 'cancelled';
				item.error = null;
				void persistItem(item);
			}
		} else if (importQueue.items.includes(item)) {
			item.status = 'waiting';
			item.error = message(error);
			void persistItem(item);
		}
	} finally {
		if (controllers.get(item.id) === controller) controllers.delete(item.id);
	}
}

async function retryOcrWithLock(item: ImportQueueItem) {
	const expectedStatus = item.status;
	const acquired = await withImportLock(item, () => retryOcr(item));
	if (!acquired) {
		scheduleImportRetry(item, () => void retryOcrWithLock(item), expectedStatus);
	}
	return acquired;
}

export function retryImport(itemId: string) {
	clearImportRetry(itemId);
	const item = importQueue.items.find((candidate) => candidate.id === itemId);
	if (!item || !['failed', 'cancelled', 'waiting'].includes(item.status)) return;
	if (item.result) void retryOcrWithLock(item);
	else void processItemWithLock(item);
}

export function removeImport(itemId: string) {
	clearImportRetry(itemId);
	cancelImport(itemId);
	const index = importQueue.items.findIndex((candidate) => candidate.id === itemId);
	if (index < 0) return;
	const [item] = importQueue.items.splice(index, 1);
	if (!item) return;
	if (!terminalStatus(item)) item.status = 'cancelled';
	void persistItem(item).finally(() => itemStores.delete(item.id));
	releasePreview(item);
	queuedFiles.delete(item.file);
}

export function clearFinishedImports() {
	for (const item of [...importQueue.items]) {
		if (['complete', 'needs_review', 'duplicate', 'cancelled'].includes(item.status)) {
			removeImport(item.id);
		}
	}
}

export async function restoreImageImports(userId: string, store?: ImportResumeStore) {
	if (restoringUsers.has(userId)) return;
	restoringUsers.add(userId);
	try {
		const records = store
			? await listStoredImageImports(userId, store)
			: await listStoredImageImports(userId);
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
					if (store) await deleteStoredImageImport(record.id, store);
					else await deleteStoredImageImport(record.id);
					completedBeforeRestore.forget(record.id);
				} catch {
					// Keep the tombstone so a later restoration cannot revive the stale record.
				}
				continue;
			}
			const remoteSession = sessionsByKey.get(record.resumeKey);
			if (remoteSession?.status === 'completed' || remoteSession?.status === 'cancelled') {
				try {
					if (store) await deleteStoredImageImport(record.id, store);
					else await deleteStoredImageImport(record.id);
				} catch {
					// A future restoration can retry deletion without re-uploading in this session.
				}
				continue;
			}
			if (importQueue.items.some((item) => item.id === record.id)) continue;
			const item: ImportQueueItem = {
				id: record.id,
				userId: record.userId,
				sessionId: remoteSession?.id ?? record.sessionId ?? null,
				resumeKey: record.resumeKey,
				file: record.file,
				mode: record.mode,
				notebookId: record.notebookId,
				status: record.result ? 'waiting' : 'queued',
				previewUrl: null,
				preparedBytes: record.preparedBytes,
				result: record.result,
				duplicateDocumentId: null,
				error: record.error
			};
			const queuedItem = appendImportItem(item);
			if (store) itemStores.set(queuedItem.id, store);
			queuedFiles.add(queuedItem.file);
			if (queuedItem.result) void retryOcrWithLock(queuedItem);
			else void processItemWithLock(queuedItem);
		}
	} finally {
		restoringUsers.delete(userId);
	}
}
