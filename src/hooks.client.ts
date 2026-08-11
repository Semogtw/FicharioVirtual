import { invalidateAll } from '$app/navigation';
import type { ClientInit } from '@sveltejs/kit';
import { pauseQueue, resumeQueue } from '$lib/import/job-runner';
import { createOcrQueueLifecycle } from '$lib/import/job-runner-lifecycle';
import { restoreImageImports } from '$lib/stores/import-queue.svelte';
import { restorePdfImports } from '$lib/stores/pdf-import-queue.svelte';
import { initializeTheme } from '$lib/theme/theme';
import {
	initializeSession,
	sessionState,
	startSessionTracking,
	subscribeSessionAuthorization
} from '$lib/stores/session.svelte';

export const init: ClientInit = () => {
	initializeTheme();
	const ocrQueueLifecycle = createOcrQueueLifecycle(() => void resumeQueue());
	subscribeSessionAuthorization((authorized) => {
		if (authorized) ocrQueueLifecycle.start();
		else {
			ocrQueueLifecycle.stop();
			pauseQueue();
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
