import { invalidateAll } from '$app/navigation';
import type { ClientInit } from '@sveltejs/kit';
import { initializeSession, startSessionTracking } from '$lib/stores/session.svelte';

export const init: ClientInit = () => {
	void initializeSession();
	try {
		startSessionTracking(() => void invalidateAll());
	} catch {
		// initializeSession publishes the safe startup error when public configuration is unavailable.
	}
};
