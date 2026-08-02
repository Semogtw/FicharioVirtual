import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';

export type AuthServiceErrorCode =
	| 'invalid_input'
	| 'invalid_credentials'
	| 'not_authorized'
	| 'auth_unavailable';

type ServiceError = { message: string; status?: number };

type AllowlistQuery = {
	select(columns: string): AllowlistQuery;
	eq(column: string, value: string | boolean): AllowlistQuery;
	maybeSingle(): Promise<{ data: { is_active: boolean } | null; error: ServiceError | null }>;
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

async function closeUnauthorizedSession(client: AuthClientLike) {
	const { error } = await client.auth.signOut();
	if (error) throw new AuthServiceError('auth_unavailable');
}

async function authorizeSession(
	session: Session,
	client: AuthClientLike
): Promise<Session | null> {
	const { data, error } = await client
		.from('app_users')
		.select('is_active')
		.eq('user_id', session.user.id)
		.eq('is_active', true)
		.maybeSingle();

	if (error) throw new AuthServiceError('auth_unavailable');
	if (data?.is_active === true) return session;

	await closeUnauthorizedSession(client);
	return null;
}

export async function loadAuthorizedSession(
	client: AuthClientLike = defaultClient()
): Promise<Session | null> {
	const { data, error } = await client.auth.getSession();
	if (error) throw new AuthServiceError('auth_unavailable');
	if (data.session === null) return null;
	return authorizeSession(data.session, client);
}

export async function signIn(
	email: string,
	password: string,
	client: AuthClientLike = defaultClient()
): Promise<Session> {
	const credentials = normalizeCredentials(email, password);
	const { data, error } = await client.auth.signInWithPassword(credentials);

	if (error) {
		const invalidCredentials =
			error.status === 400 ||
			error.status === 401 ||
			/invalid login|invalid credentials/i.test(error.message);
		throw new AuthServiceError(invalidCredentials ? 'invalid_credentials' : 'auth_unavailable');
	}
	if (data.session === null) throw new AuthServiceError('auth_unavailable');

	const authorized = await authorizeSession(data.session, client);
	if (authorized === null) throw new AuthServiceError('not_authorized');
	return authorized;
}

export async function signOut(client: AuthClientLike = defaultClient()): Promise<void> {
	const { error } = await client.auth.signOut();
	if (error) throw new AuthServiceError('auth_unavailable');
}
