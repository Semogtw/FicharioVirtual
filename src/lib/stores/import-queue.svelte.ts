import type { ImagePreparationMode } from '$lib/import/image-types';
import { prepareImage } from '$lib/import/image-client';
import {
	DuplicateImageError,
	uploadPreparedImage,
	type UploadedPage
} from '$lib/import/upload';
import { recordOcrConsent } from '$lib/services/ocr-consent';

export type ImportQueueStatus =
	| 'queued'
	| 'preparing'
	| 'uploading'
	| 'complete'
	| 'duplicate'
	| 'failed'
	| 'cancelled';

export type ImportQueueItem = {
	id: string;
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

const controllers = new Map<string, AbortController>();
const localFingerprints = new Set<string>();
let consentPromise: Promise<void> | null = null;

function id() {
	return globalThis.crypto?.randomUUID?.() ?? `import_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function fingerprint(file: File) {
	return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

function message(error: unknown) {
	return error instanceof Error ? error.message : 'Não foi possível importar este arquivo.';
}

function releasePreview(item: ImportQueueItem) {
	if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
	item.previewUrl = null;
}

function ensureConsent() {
	consentPromise ??= recordOcrConsent().catch((error) => {
		consentPromise = null;
		throw error;
	});
	return consentPromise;
}

async function processItem(item: ImportQueueItem) {
	if (item.status === 'preparing' || item.status === 'uploading') return;
	const controller = new AbortController();
	controllers.set(item.id, controller);
	item.error = null;
	item.result = null;
	item.duplicateDocumentId = null;
	item.status = 'preparing';

	try {
		await ensureConsent();
		if (controller.signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
		const prepared = await prepareImage(item.file, item.mode, { signal: controller.signal });
		releasePreview(item);
		item.previewUrl = URL.createObjectURL(prepared.thumbnail);
		item.preparedBytes = prepared.preparedBytes;
		item.status = 'uploading';
		item.result = await uploadPreparedImage({
			prepared,
			notebookId: item.notebookId,
			signal: controller.signal
		});
		item.status = 'complete';
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			item.status = 'cancelled';
			item.error = null;
		} else if (error instanceof DuplicateImageError) {
			item.status = 'duplicate';
			item.duplicateDocumentId = error.documentId;
			item.error = error.message;
		} else {
			item.status = 'failed';
			item.error = message(error);
		}
	} finally {
		controllers.delete(item.id);
	}
}

export function addImages(
	files: readonly File[],
	options: { mode?: ImagePreparationMode; notebookId?: string | null } = {}
) {
	const mode = options.mode ?? 'standard';
	for (const file of files) {
		const key = fingerprint(file);
		if (localFingerprints.has(key)) continue;
		localFingerprints.add(key);
		const item: ImportQueueItem = {
			id: id(),
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
		importQueue.items.push(item);
		void processItem(item);
	}
}

export function cancelImport(itemId: string) {
	controllers.get(itemId)?.abort();
	const item = importQueue.items.find((candidate) => candidate.id === itemId);
	if (item?.status === 'queued') item.status = 'cancelled';
}

export function retryImport(itemId: string) {
	const item = importQueue.items.find((candidate) => candidate.id === itemId);
	if (!item || !['failed', 'cancelled'].includes(item.status)) return;
	void processItem(item);
}

export function removeImport(itemId: string) {
	cancelImport(itemId);
	const index = importQueue.items.findIndex((candidate) => candidate.id === itemId);
	if (index < 0) return;
	const [item] = importQueue.items.splice(index, 1);
	if (!item) return;
	releasePreview(item);
	localFingerprints.delete(fingerprint(item.file));
}

export function clearFinishedImports() {
	for (const item of [...importQueue.items]) {
		if (['complete', 'duplicate', 'cancelled'].includes(item.status)) removeImport(item.id);
	}
}
