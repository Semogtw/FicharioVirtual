import { subscribeImportUpdates, type ImportBroadcastUpdate } from '$lib/import/import-broadcast';
import {
	importQueue,
	type ImportQueueItem,
	type ImportQueueStatus
} from '$lib/stores/import-queue.svelte';

const REMOTE_LOCKED_STATUSES = new Set(['preparing', 'uploading', 'reading', 'waiting']);
const LOCAL_YIELDABLE_STATUSES = new Set<ImportQueueStatus>(['queued', 'waiting']);

export type YieldableImageImport = Pick<ImportQueueItem, 'id' | 'status' | 'previewUrl'>;

export function yieldImageImportToRemoteTab(
	items: YieldableImageImport[],
	update: ImportBroadcastUpdate
) {
	if (update.type !== 'image-import-updated' || !REMOTE_LOCKED_STATUSES.has(update.status)) {
		return false;
	}
	const index = items.findIndex(
		(item) => item.id === update.id && LOCAL_YIELDABLE_STATUSES.has(item.status)
	);
	if (index < 0) return false;
	const [item] = items.splice(index, 1);
	if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
	if (item) item.previewUrl = null;
	return true;
}

let stop: (() => boolean) | null = null;

export function startImageImportCrossTabYield() {
	if (stop) return;
	stop = subscribeImportUpdates((update) => {
		yieldImageImportToRemoteTab(importQueue.items, update);
	});
}
