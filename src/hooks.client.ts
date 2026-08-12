import { invalidateAll } from '$app/navigation';
import type { ClientInit } from '@sveltejs/kit';
import { startImageImportCrossTabYield } from '$lib/import/image-import-cross-tab-yield';
import { createOcrQueueLifecycle } from '$lib/import/job-runner-lifecycle';
import { installServiceWorkerUpdateReload } from '$lib/pwa/service-worker-update';
import { kickOcrQueueBestEffort } from '$lib/services/ocr-background';
import { restoreImageImports } from '$lib/stores/import-queue.svelte';
import { restorePdfImports } from '$lib/stores/pdf-import-queue.svelte';
import {
	initializeSession,
	sessionState,
	startSessionTracking,
	subscribeSessionAuthorization
} from '$lib/stores/session.svelte';
import { initializeTheme } from '$lib/theme/theme';

export const init: ClientInit = () => {
	installServiceWorkerUpdateReload();
	initializeTheme();
	startImageImportCrossTabYield();
	const ocrQueueLifecycle = createOcrQueueLifecycle(() => kickOcrQueueBestEffort());
	subscribeSessionAuthorization((authorized) => {
		if (authorized) ocrQueueLifecycle.start();
		else ocrQueueLifecycle.stop();
		if (authorized && sessionState.user) {
			void restoreImageImports(sessionState.user.id);
			void restorePdfImports(sessionState.user.id);
		}
	});
	void initializeSession();
	try {
		startSessionTracking(() => void invalidateAll());
	} catch {
		// initializeSession publishes the safe startup error when public configuration is unavailable.
	}
};
