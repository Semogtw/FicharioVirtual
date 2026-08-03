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
			onAuthStateChange: vi.fn(() => ({
				data: { subscription: { unsubscribe: vi.fn() } }
			}))
		}
	}))
}));

import {
	authenticate,
	initializeSession,
	sessionState
} from '../../../src/lib/stores/session.svelte';

const authenticatedSession = {
	user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test' }
} as never;

describe('session operation ordering', () => {
	beforeEach(() => {
		sessionState.loading = false;
		sessionState.user = null;
		sessionState.authorized = false;
		sessionState.error = null;
		auth.loadAuthorizedSession.mockReset();
		auth.signIn.mockReset();
		auth.signOut.mockReset();
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
});
