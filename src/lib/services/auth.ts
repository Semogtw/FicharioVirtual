import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';

export type AuthServiceErrorCode =
	'invalid_input' | 'invalid_credentials' | 'not_authorized' | 'auth_unavailable';

type ServiceError = { message: string; status?: number };
type SignOutScope = 'global' | 'local' | 'others';

type AllowlistQuery = {
	select(columns: string): AllowlistQuery;
	eq(column: string, value: string | boolean): AllowlistQuery;
	maybeSingle(): Promise<{ data: unknown; error: ServiceError | null }>;
};

type PendingAllowlistChecks = Map<string, Promise<boolean | null>>;

export type AuthClientLike = {
	auth: {
		getSession(): Promise<{ data: { session: Session | null }; error: ServiceError | null }>;
		signInWithPassword(input: {
			email: string;
			password: string;
		}): Promise<{ data: { session: Session | null }; error: ServiceError | null }>;
		signOut(options?: { scope?: SignOutScope }): Promise<{ error: ServiceError | null }>;
	};
	from(table: 'app_users'): AllowlistQuery;
};

const messages: Record<AuthServiceErrorCode, string> = {
	invalid_input: 'Informe um e-mail e uma senha válidos.',
	invalid_credentials: 'E-mail ou senha incorretos.',
	not_authorized: 'Esta conta não está autorizada a acessar o fichário.',
	auth_unavailable: 'Não foi possível confirmar o acesso agora. Tente novamente.'
};

// Layout loading and client session initialization can overlap during the first
// browser render. Share only the in-flight check: a later authorization change
// still performs a fresh query, so revocations are not hidden by a long cache.
const pendingAllowlistChecks = new WeakMap<AuthClientLike, PendingAllowlistChecks>();

export class AuthServiceError extends Error {
	readonly code: AuthServiceErrorCode;

	constructor(code: AuthServiceErrorCode) {
		super(messages[code]);
		this.name = 'AuthServiceError';
		this.code = code;
	}
}

function defaultClient(): AuthClientLike {
	return getSupabaseClient() as unknown as AuthClientLike;
}

function normalizeCredentials(email: string, password: string) {
	const normalizedEmail = email.trim().toLowerCase();
	if (
		normalizedEmail.length < 3 ||
		normalizedEmail.length > 254 ||
		!normalizedEmail.includes('@') ||
		password.length < 1 ||
		password.length > 4096
	) {
		throw new AuthServiceError('invalid_input');
	}
	return { email: normalizedEmail, password };
}

function unavailable(error: unknown): never {
	if (error instanceof AuthServiceError) throw error;
	throw new AuthServiceError('auth_unavailable');
}

function parseAllowlistRow(data: unknown): boolean | null {
	if (data === null) return null;
	if (typeof data !== 'object' || Array.isArray(data)) {
		throw new AuthServiceError('auth_unavailable');
	}
	const keys = Object.keys(data);
	if (keys.length !== 1 || keys[0] !== 'is_active') {
		throw new AuthServiceError('auth_unavailable');
	}
	const active = (data as { is_active?: unknown }).is_active;
	if (typeof active !== 'boolean') throw new AuthServiceError('auth_unavailable');
	return active;
}

async function closeUnauthorizedSession(client: AuthClientLike) {
	try {
		const { error } = await client.auth.signOut({ scope: 'global' });
		if (error) throw new AuthServiceError('auth_unavailable');
	} catch (error) {
		unavailable(error);
	}
}

async function checkAllowlist(session: Session, client: AuthClientLike): Promise<boolean | null> {
	let data: unknown;
	try {
		const response = await client
			.from('app_users')
			.select('is_active')
			.eq('user_id', session.user.id)
			.eq('is_active', true)
			.maybeSingle();
		if (response.error) throw new AuthServiceError('auth_unavailable');
		data = response.data;
	} catch (error) {
		unavailable(error);
	}

	try {
		return parseAllowlistRow(data);
	} catch (error) {
		unavailable(error);
	}
}

function getAllowlistCheck(session: Session, client: AuthClientLike): Promise<boolean | null> {
	let checks = pendingAllowlistChecks.get(client);
	if (checks === undefined) {
		checks = new Map();
		pendingAllowlistChecks.set(client, checks);
	}

	const existing = checks.get(session.user.id);
	if (existing !== undefined) return existing;

	const pending = checkAllowlist(session, client);
	checks.set(session.user.id, pending);
	const clear = () => {
		if (checks?.get(session.user.id) === pending) checks.delete(session.user.id);
	};
	void pending.then(clear, clear);
	return pending;
}

async function authorizeSession(session: Session, client: AuthClientLike): Promise<Session | null> {
	const active = await getAllowlistCheck(session, client);
	if (active === true) return session;

	await closeUnauthorizedSession(client);
	return null;
}

export async function loadPersistedSession(
	client: AuthClientLike = defaultClient()
): Promise<Session | null> {
	try {
		const { data, error } = await client.auth.getSession();
		if (error) throw new AuthServiceError('auth_unavailable');
		return data.session;
	} catch (error) {
		unavailable(error);
	}
}

export async function loadAuthorizedSession(
	client: AuthClientLike = defaultClient()
): Promise<Session | null> {
	const session = await loadPersistedSession(client);
	if (session === null) return null;
	return authorizeSession(session, client);
}

export async function signIn(
	email: string,
	password: string,
	client?: AuthClientLike
): Promise<Session> {
	const credentials = normalizeCredentials(email, password);
	const gateway = client ?? defaultClient();
	try {
		const { data, error } = await gateway.auth.signInWithPassword(credentials);

		if (error) {
			const invalidCredentials =
				error.status === 400 ||
				error.status === 401 ||
				/invalid login|invalid credentials/i.test(error.message);
			throw new AuthServiceError(invalidCredentials ? 'invalid_credentials' : 'auth_unavailable');
		}
		if (data.session === null) throw new AuthServiceError('auth_unavailable');

		const authorized = await authorizeSession(data.session, gateway);
		if (authorized === null) throw new AuthServiceError('not_authorized');
		return authorized;
	} catch (error) {
		unavailable(error);
	}
}

export async function signOut(client: AuthClientLike = defaultClient()): Promise<void> {
	try {
		const { error } = await client.auth.signOut({ scope: 'local' });
		if (error) throw new AuthServiceError('auth_unavailable');
	} catch (error) {
		unavailable(error);
	}
}
