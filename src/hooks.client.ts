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

type IdleWindow = Window & {
	requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

function scheduleAfterFirstPaint(callback: () => void) {
	const idleWindow = typeof window === 'undefined' ? null : (window as IdleWindow);
	if (idleWindow?.requestIdleCallback !== undefined) {
		idleWindow.requestIdleCallback(callback, { timeout: 2000 });
		return;
	}
	setTimeout(callback, 1000);
}

export const init: ClientInit = () => {
	installServiceWorkerUpdateReload();
	initializeTheme();
	startImageImportCrossTabYield();
	let authorizationEpoch = 0;
	let deferNextOcrKick = true;
	const ocrQueueLifecycle = createOcrQueueLifecycle(() => {
		if (deferNextOcrKick) {
			deferNextOcrKick = false;
			const scheduledEpoch = authorizationEpoch;
			scheduleAfterFirstPaint(() => {
				if (scheduledEpoch === authorizationEpoch && sessionState.authorized) {
					kickOcrQueueBestEffort();
				}
			});
			return;
		}
		kickOcrQueueBestEffort();
	});
	subscribeSessionAuthorization((authorized) => {
		authorizationEpoch += 1;
		if (authorized) {
			deferNextOcrKick = true;
			ocrQueueLifecycle.start();
		} else {
			ocrQueueLifecycle.stop();
		}
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
