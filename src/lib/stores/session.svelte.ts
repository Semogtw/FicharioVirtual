import type { Session, User } from '@supabase/supabase-js';
import {
	AuthServiceError,
	loadAuthorizedSession,
	loadPersistedSession,
	signIn,
	signOut,
	signUp,
	type SignUpResult
} from '$lib/services/auth';
import { getSupabaseClient } from '$lib/services/supabase';

type SessionState = {
	loading: boolean;
	user: User | null;
	authorized: boolean;
	error: string | null;
};

type SessionAuthorizationListener = (authorized: boolean) => void;

export const sessionState = $state<SessionState>({
	loading: true,
	user: null,
	authorized: false,
	error: null
});

const authorizationListeners = new Set<SessionAuthorizationListener>();
let operationVersion = 0;
let explicitSignInOperations = 0;
let explicitSignOutOperations = 0;

function message(error: unknown): string {
	return error instanceof AuthServiceError
		? error.message
		: 'Não foi possível confirmar a sessão agora.';
}

function publishAuthorization(authorized: boolean) {
	for (const listener of [...authorizationListeners]) {
		try {
			listener(authorized);
		} catch {
			// Session state remains authoritative when an optional lifecycle consumer fails.
		}
	}
}

function applySession(session: Session | null) {
	const previousUserId = sessionState.user?.id ?? null;
	const previousAuthorization = sessionState.authorized;
	const nextUser = session?.user ?? null;
	sessionState.user = nextUser;
	sessionState.authorized = session !== null;
	sessionState.error = null;
	if (
		previousAuthorization !== sessionState.authorized ||
		previousUserId !== (nextUser?.id ?? null)
	) {
		publishAuthorization(sessionState.authorized);
	}
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

export function subscribeSessionAuthorization(listener: SessionAuthorizationListener): () => void {
	authorizationListeners.add(listener);
	return () => authorizationListeners.delete(listener);
}

export async function initializeSession(): Promise<Session | null> {
	const version = beginOperation();
	try {
		const session = await loadAuthorizedSession();
		if (isCurrentOperation(version)) applySession(session);
		return session;
	} catch (error) {
		if (!isCurrentOperation(version)) return null;

		try {
			const persistedSession = await loadPersistedSession();
			if (!isCurrentOperation(version)) return persistedSession;
			if (persistedSession !== null) {
				applySession(persistedSession);
				return persistedSession;
			}
		} catch {
			// Keep the original authorization failure as the user-facing startup error.
		}

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
	explicitSignInOperations += 1;
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
		explicitSignInOperations -= 1;
	}
}

export async function register(email: string, password: string): Promise<SignUpResult> {
	explicitSignInOperations += 1;
	const version = beginOperation();
	if (isCurrentOperation(version)) sessionState.error = null;
	try {
		const result = await signUp(email, password);
		if (!isCurrentOperation(version)) throw supersededError();
		applySession(result.session);
		return result;
	} catch (error) {
		if (isCurrentOperation(version)) {
			applySession(null);
			sessionState.error = message(error);
		}
		throw error;
	} finally {
		if (isCurrentOperation(version)) sessionState.loading = false;
		explicitSignInOperations -= 1;
	}
}

export async function endSession(): Promise<void> {
	explicitSignOutOperations += 1;
	const version = beginOperation();
	try {
		await signOut();
		if (isCurrentOperation(version)) applySession(null);
	} catch (error) {
		if (isCurrentOperation(version)) sessionState.error = message(error);
		throw error;
	} finally {
		if (isCurrentOperation(version)) sessionState.loading = false;
		explicitSignOutOperations -= 1;
	}
}

export function startSessionTracking(onExternalSessionChange?: () => void): () => void {
	const client = getSupabaseClient();
	let active = true;
	let trackingEventVersion = 0;
	const {
		data: { subscription }
	} = client.auth.onAuthStateChange((event, session) => {
		const eventVersion = ++trackingEventVersion;
		queueMicrotask(() => {
			if (!active || eventVersion !== trackingEventVersion || event === 'INITIAL_SESSION') return;
			if (session === null) {
				const shouldNotifyExternalChange =
					explicitSignOutOperations === 0 && explicitSignInOperations === 0;
				invalidateOperations();
				applySession(null);
				sessionState.loading = false;
				if (shouldNotifyExternalChange) onExternalSessionChange?.();
				return;
			}
			if (explicitSignInOperations > 0) return;

			const previousUserId = sessionState.user?.id ?? null;
			const wasAuthorized = sessionState.authorized;
			const sameAuthorizedUser = wasAuthorized && previousUserId === session.user.id;
			if (
				sameAuthorizedUser &&
				(event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'USER_UPDATED')
			) {
				invalidateOperations();
				applySession(session);
				sessionState.loading = false;
				return;
			}

			void initializeSession().then((authorizedSession) => {
				if (
					!active ||
					eventVersion !== trackingEventVersion ||
					authorizedSession === null ||
					!sessionState.authorized
				) {
					return;
				}
				if (!wasAuthorized || previousUserId !== sessionState.user?.id) {
					onExternalSessionChange?.();
				}
			});
	});

	return () => {
		active = false;
		trackingEventVersion += 1;
		subscription.unsubscribe();
	};
}
