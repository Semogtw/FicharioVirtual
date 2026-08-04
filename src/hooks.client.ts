import { invalidateAll } from '$app/navigation';
import type { ClientInit } from '@sveltejs/kit';
import { pauseQueue, resumeQueue } from '$lib/import/job-runner';
import {
	initializeSession,
	startSessionTracking,
	subscribeSessionAuthorization
} from '$lib/stores/session.svelte';

export const init: ClientInit = () => {
	subscribeSessionAuthorization((authorized) => {
		if (authorized) void resumeQueue();
		else pauseQueue();
	});
	void initializeSession();
	try {
		startSessionTracking(() => void invalidateAll());
	} catch {
		// initializeSession publishes the safe startup error when public configuration is unavailable.
	}
};
