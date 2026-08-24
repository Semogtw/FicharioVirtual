import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import {
	loadAuthorizedSession,
	loadCurrentProviderProfile,
	loadPersistedSession,
	type ProviderProfile
} from '$lib/services/auth';
import type { LayoutLoad } from './$types';

export const prerender = true;
export const ssr = false;
export const trailingSlash = 'always';

export const load: LayoutLoad = async ({ url }) => {
	const isLoginRoute = url.pathname.startsWith('/login');

	if (!browser) {
		return { session: null, authState: 'unverified' as const, providerProfile: null };
	}

	let session;
	let providerProfile: ProviderProfile | null = null;
	try {
		session = await loadAuthorizedSession();
		if (session !== null) providerProfile = await loadCurrentProviderProfile();
	} catch {
		let persistedSession: Awaited<ReturnType<typeof loadPersistedSession>> = null;
		try {
			persistedSession = await loadPersistedSession();
		} catch {
			// A missing persisted session below is the only case that sends the user back to login.
		}

		if (persistedSession !== null) {
			if (isLoginRoute) redirect(307, '/');
			return {
				session: persistedSession,
				authState: 'session_preserved' as const,
				providerProfile: null
			};
		}
		if (!isLoginRoute) {
			redirect(307, '/login/?reason=unavailable');
		}
		return { session: null, authState: 'unavailable' as const, providerProfile: null };
	}

	if (session === null && !isLoginRoute) {
		redirect(307, '/login/');
	}
	if (session !== null && isLoginRoute) {
		redirect(307, '/');
	}
	return {
		session,
		authState: session === null ? ('anonymous' as const) : ('authorized' as const),
		providerProfile
	};
};
