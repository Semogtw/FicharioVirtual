import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { loadAuthorizedSession } from '$lib/services/auth';
import type { LayoutLoad } from './$types';

export const prerender = true;
export const ssr = false;
export const trailingSlash = 'always';

export const load: LayoutLoad = async ({ url }) => {
	const isLoginRoute = url.pathname.startsWith('/login');

	if (!browser) {
		return { session: null, authState: 'unverified' as const };
	}

	let session;
	try {
		session = await loadAuthorizedSession();
	} catch {
		if (!isLoginRoute) {
			redirect(307, '/login/?reason=unavailable');
		}
		return { session: null, authState: 'unavailable' as const };
	}

	if (session === null && !isLoginRoute) {
		redirect(307, '/login/');
	}
	if (session !== null && isLoginRoute) {
		redirect(307, '/');
	}
	return {
		session,
		authState: session === null ? ('anonymous' as const) : ('authorized' as const)
	};
};
