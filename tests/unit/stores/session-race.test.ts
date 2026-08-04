import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

const auth = vi.hoisted(() => ({
	loadAuthorizedSession: vi.fn(),
	signIn: vi.fn(),
	signOut: vi.fn()
}));

const tracking = vi.hoisted(() => ({
	callback: null as null | ((event: string, session: unknown) => void),
	unsubscribe: vi.fn()
}));

vi.mock('$lib/services/auth', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/services/auth')>();
	return {
		...original,
		loadAuthorizedSession: auth.loadAuthorizedSession,
		signIn: auth.signIn,
		signOut: auth.signOut
	};
});

vi.mock('$lib/services/supabase', () => ({
	getSupabaseClient: vi.fn(() => ({
		auth: {
			onAuthStateChange: vi.fn((callback) => {
				tracking.callback = callback;
				return { data: { subscription: { unsubscribe: tracking.unsubscribe } } };
			})
		}
	}))
}));

import {
	authenticate,
	endSession,
	initializeSession,
	sessionState,
	startSessionTracking
} from '../../../src/lib/stores/session.svelte';

const authenticatedSession = {
	user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test' }
} as unknown as Session;

describe('session operation ordering', () => {
	beforeEach(() => {
		sessionState.loading = false;
		sessionState.user = null;
		sessionState.authorized = false;
		sessionState.error = null;
		auth.loadAuthorizedSession.mockReset();
		auth.signIn.mockReset();
		auth.signOut.mockReset();
		tracking.callback = null;
		tracking.unsubscribe.mockReset();
	});

	it('does not let a stale initialization erase a newer authenticated session', async () => {
		const initialization = deferred<null>();
		auth.loadAuthorizedSession.mockReturnValueOnce(initialization.promise);
		auth.signIn.mockResolvedValueOnce(authenticatedSession);

		const initializing = initializeSession();
		const signingIn = authenticate('owner@example.test', 'password');
		await signingIn;

		expect(sessionState.authorized).toBe(true);
		expect(sessionState.user?.id).toBe('11111111-1111-4111-8111-111111111111');

		initialization.resolve(null);
		await initializing;

		expect(sessionState.authorized).toBe(true);
		expect(sessionState.user?.id).toBe('11111111-1111-4111-8111-111111111111');
		expect(sessionState.loading).toBe(false);
	});

	it('does not let a pending sign-in revive a session after a signed-out event', async () => {
		const signingIn = deferred<typeof authenticatedSession>();
		auth.signIn.mockReturnValueOnce(signingIn.promise);
		const stopTracking = startSessionTracking();

		const authentication = authenticate('owner@example.test', 'password');
		tracking.callback?.('SIGNED_OUT', null);
		await Promise.resolve();

		expect(sessionState.authorized).toBe(false);
		expect(sessionState.user).toBeNull();

		signingIn.resolve(authenticatedSession);
		await expect(authentication).rejects.toMatchObject({ name: 'AbortError' });

		expect(sessionState.authorized).toBe(false);
		expect(sessionState.user).toBeNull();
		expect(sessionState.loading).toBe(false);

		stopTracking();
		expect(tracking.unsubscribe).toHaveBeenCalledOnce();
	});

	it('does not start duplicate authorization while an explicit sign-in is active', async () => {
		const signingIn = deferred<typeof authenticatedSession>();
		auth.signIn.mockReturnValueOnce(signingIn.promise);
		auth.loadAuthorizedSession.mockResolvedValueOnce(authenticatedSession);
		const stopTracking = startSessionTracking();

		const authentication = authenticate('owner@example.test', 'password');
		tracking.callback?.('SIGNED_IN', authenticatedSession);
		await Promise.resolve();

		expect(auth.loadAuthorizedSession).not.toHaveBeenCalled();

		signingIn.resolve(authenticatedSession);
		await expect(authentication).resolves.toBe(authenticatedSession);
		expect(sessionState.authorized).toBe(true);
		expect(sessionState.user?.id).toBe('11111111-1111-4111-8111-111111111111');

		stopTracking();
	});

	it('ignores an auth event already queued when session tracking stops', async () => {
		sessionState.user = authenticatedSession.user;
		sessionState.authorized = true;
		const stopTracking = startSessionTracking();

		tracking.callback?.('SIGNED_OUT', null);
		stopTracking();
		await Promise.resolve();

		expect(tracking.unsubscribe).toHaveBeenCalledOnce();
		expect(sessionState.authorized).toBe(true);
		expect(sessionState.user?.id).toBe('11111111-1111-4111-8111-111111111111');
	});

	it('requests route revalidation for an external sign-out but not the initial session event', async () => {
		const onExternalSignOut = vi.fn();
		const stopTracking = startSessionTracking(onExternalSignOut);

		tracking.callback?.('INITIAL_SESSION', null);
		await Promise.resolve();
		expect(onExternalSignOut).not.toHaveBeenCalled();

		sessionState.user = authenticatedSession.user;
		sessionState.authorized = true;
		tracking.callback?.('SIGNED_OUT', null);
		await Promise.resolve();
		expect(onExternalSignOut).toHaveBeenCalledOnce();

		stopTracking();
	});

	it('does not revalidate routes for the explicit sign-out that already owns navigation', async () => {
		const onExternalSignOut = vi.fn();
		const stopTracking = startSessionTracking(onExternalSignOut);
		sessionState.user = authenticatedSession.user;
		sessionState.authorized = true;
		auth.signOut.mockImplementationOnce(async () => {
			tracking.callback?.('SIGNED_OUT', null);
			await Promise.resolve();
		});

		await endSession();
		await Promise.resolve();

		expect(onExternalSignOut).not.toHaveBeenCalled();
		stopTracking();
	});
});
