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

let operationVersion = 0;
let explicitSignOutInProgress = false;

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

function beginOperation() {
	operationVersion += 1;
	sessionState.loading = true;
	return operationVersion;
}

function isCurrentOperation(version: number) {
	return version === operationVersion;
}

function invalidateOperations() {
	operationVersion += 1;
}

function supersededError() {
	return new DOMException('Session operation was superseded', 'AbortError');
}

export async function initializeSession(): Promise<Session | null> {
	const version = beginOperation();
	try {
		const session = await loadAuthorizedSession();
		if (isCurrentOperation(version)) applySession(session);
		return session;
	} catch (error) {
		if (isCurrentOperation(version)) {
			applySession(null);
			sessionState.error = message(error);
		}
		return null;
	} finally {
		if (isCurrentOperation(version)) sessionState.loading = false;
	}
}

export async function authenticate(email: string, password: string): Promise<Session> {
	const version = beginOperation();
	if (isCurrentOperation(version)) sessionState.error = null;
	try {
		const session = await signIn(email, password);
		if (!isCurrentOperation(version)) throw supersededError();
		applySession(session);
		return session;
	} catch (error) {
		if (isCurrentOperation(version)) {
			applySession(null);
			sessionState.error = message(error);
		}
		throw error;
	} finally {
		if (isCurrentOperation(version)) sessionState.loading = false;
	}
}

export async function endSession(): Promise<void> {
	explicitSignOutInProgress = true;
	const version = beginOperation();
	try {
		await signOut();
		if (isCurrentOperation(version)) applySession(null);
	} catch (error) {
		if (isCurrentOperation(version)) sessionState.error = message(error);
		throw error;
	} finally {
		if (isCurrentOperation(version)) sessionState.loading = false;
		explicitSignOutInProgress = false;
	}
}

export function startSessionTracking(onExternalSignOut?: () => void): () => void {
	const client = getSupabaseClient();
	let active = true;
	const {
		data: { subscription }
	} = client.auth.onAuthStateChange((event, session) => {
		queueMicrotask(() => {
			if (!active || event === 'INITIAL_SESSION') return;
			if (session === null) {
				const shouldNotifyExternalSignOut =
					!explicitSignOutInProgress && sessionState.authorized;
				invalidateOperations();
				applySession(null);
				sessionState.loading = false;
				if (shouldNotifyExternalSignOut) onExternalSignOut?.();
				return;
			}
			if (sessionState.loading) return;
			void initializeSession();
		});
	});

	return () => {
		active = false;
		subscription.unsubscribe();
	};
}
