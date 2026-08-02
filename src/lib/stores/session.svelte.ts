import type { Session, User } from '@supabase/supabase-js';
import { AuthServiceError, loadAuthorizedSession, signIn, signOut } from '$lib/services/auth';
import { getSupabaseClient } from '$lib/services/supabase';

type SessionState = {
	loading: boolean;
	user: User | null;
	authorized: boolean;
	error: string | null;
};

export const sessionState = $state<SessionState>({
	loading: true,
	user: null,
	authorized: false,
	error: null
});

function message(error: unknown): string {
	return error instanceof AuthServiceError
		? error.message
		: 'Não foi possível confirmar a sessão agora.';
}

function applySession(session: Session | null) {
	sessionState.user = session?.user ?? null;
	sessionState.authorized = session !== null;
	sessionState.error = null;
}

export async function initializeSession(): Promise<Session | null> {
	sessionState.loading = true;
	try {
		const session = await loadAuthorizedSession();
		applySession(session);
		return session;
	} catch (error) {
		applySession(null);
		sessionState.error = message(error);
		return null;
	} finally {
		sessionState.loading = false;
	}
}

export async function authenticate(email: string, password: string): Promise<Session> {
	sessionState.loading = true;
	sessionState.error = null;
	try {
		const session = await signIn(email, password);
		applySession(session);
		return session;
	} catch (error) {
		applySession(null);
		sessionState.error = message(error);
		throw error;
	} finally {
		sessionState.loading = false;
	}
}

export async function endSession(): Promise<void> {
	sessionState.loading = true;
	try {
		await signOut();
		applySession(null);
	} catch (error) {
		sessionState.error = message(error);
		throw error;
	} finally {
		sessionState.loading = false;
	}
}

export function startSessionTracking(): () => void {
	const client = getSupabaseClient();
	const {
		data: { subscription }
	} = client.auth.onAuthStateChange((_event, session) => {
		queueMicrotask(() => {
			if (session === null) {
				applySession(null);
				sessionState.loading = false;
				return;
			}
			void initializeSession();
		});
	});

	return () => subscription.unsubscribe();
}
