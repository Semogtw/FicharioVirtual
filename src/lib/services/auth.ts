import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';

export type AuthServiceErrorCode =
	'invalid_input' | 'invalid_credentials' | 'not_authorized' | 'auth_unavailable';

type ServiceError = { message: string; status?: number };

type AllowlistQuery = {
	select(columns: string): AllowlistQuery;
	eq(column: string, value: string | boolean): AllowlistQuery;
	maybeSingle(): Promise<{ data: unknown; error: ServiceError | null }>;
};

export type AuthClientLike = {
	auth: {
		getSession(): Promise<{ data: { session: Session | null }; error: ServiceError | null }>;
		signInWithPassword(input: {
			email: string;
			password: string;
		}): Promise<{ data: { session: Session | null }; error: ServiceError | null }>;
		signOut(): Promise<{ error: ServiceError | null }>;
	};
	from(table: 'app_users'): AllowlistQuery;
};

const messages: Record<AuthServiceErrorCode, string> = {
	invalid_input: 'Informe um e-mail e uma senha válidos.',
	invalid_credentials: 'E-mail ou senha incorretos.',
	not_authorized: 'Esta conta não está autorizada a acessar o fichário.',
	auth_unavailable: 'Não foi possível confirmar o acesso agora. Tente novamente.'
};

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
		const { error } = await client.auth.signOut();
		if (error) throw new AuthServiceError('auth_unavailable');
	} catch (error) {
		unavailable(error);
	}
}

async function authorizeSession(session: Session, client: AuthClientLike): Promise<Session | null> {
	try {
		const { data, error } = await client
			.from('app_users')
			.select('is_active')
			.eq('user_id', session.user.id)
			.eq('is_active', true)
			.maybeSingle();

		if (error) throw new AuthServiceError('auth_unavailable');
		if (parseAllowlistRow(data) === true) return session;

		await closeUnauthorizedSession(client);
		return null;
	} catch (error) {
		unavailable(error);
	}
}

export async function loadAuthorizedSession(
	client: AuthClientLike = defaultClient()
): Promise<Session | null> {
	try {
		const { data, error } = await client.auth.getSession();
		if (error) throw new AuthServiceError('auth_unavailable');
		if (data.session === null) return null;
		return await authorizeSession(data.session, client);
	} catch (error) {
		unavailable(error);
	}
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
		const { error } = await client.auth.signOut();
		if (error) throw new AuthServiceError('auth_unavailable');
	} catch (error) {
		unavailable(error);
	}
}
