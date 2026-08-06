export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file' as const;

const REQUIRED_SCOPES = Object.freeze(['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE] as const);
const CLIENT_ID = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const OPAQUE = /^[A-Za-z0-9_-]{43,128}$/;
const SUBJECT = /^[A-Za-z0-9:_-]{6,255}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface GoogleTokenResponse {
	accessToken: string;
	expiresIn: number;
	refreshToken: string | null;
	idToken: string | null;
	scopes: readonly string[];
}

export interface GoogleIdentity {
	subject: string;
	email: string;
	expiresAt: number;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(record).every((key) => allowed.includes(key));
}

function nonEmptySecret(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 8 && value.length <= 8192;
}

function parseScopes(value: unknown): readonly string[] | null {
	if (typeof value !== 'string') return null;
	const scopes = value.split(/\s+/).filter(Boolean);
	if (scopes.length !== REQUIRED_SCOPES.length || new Set(scopes).size !== scopes.length) {
		return null;
	}
	if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope))) return null;
	return Object.freeze([...REQUIRED_SCOPES]);
}

export function validateOAuthOpaqueValue(value: string): string {
	if (!OPAQUE.test(value)) throw new TypeError('Invalid OAuth opaque value');
	return value;
}

function validateClientId(value: string): string {
	if (!CLIENT_ID.test(value) || value.length > 512) {
		throw new TypeError('Invalid Google OAuth configuration');
	}
	return value;
}

function validateRedirectUri(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError('Invalid Google OAuth configuration');
	}
	if (
		url.protocol !== 'https:' ||
		url.username !== '' ||
		url.password !== '' ||
		url.hash !== '' ||
		!url.hostname.endsWith('.supabase.co') ||
		url.pathname !== '/functions/v1/drive-oauth-callback'
	) {
		throw new TypeError('Invalid Google OAuth configuration');
	}
	return url.toString();
}

export function buildGoogleAuthorizationUrl({
	clientId,
	redirectUri,
	state,
	nonce
}: {
	clientId: string;
	redirectUri: string;
	state: string;
	nonce: string;
}): string {
	const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	url.searchParams.set('client_id', validateClientId(clientId));
	url.searchParams.set('redirect_uri', validateRedirectUri(redirectUri));
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('prompt', 'consent');
	url.searchParams.set('include_granted_scopes', 'false');
	url.searchParams.set('state', validateOAuthOpaqueValue(state));
	url.searchParams.set('nonce', validateOAuthOpaqueValue(nonce));
	return url.toString();
}

export function parseGoogleTokenResponse(
	value: unknown,
	options: { requireRefreshToken: boolean; requireIdToken: boolean }
): GoogleTokenResponse {
	const record = objectRecord(value);
	const allowed = [
		'access_token',
		'expires_in',
		'refresh_token',
		'scope',
		'token_type',
		'id_token'
	];
	if (!record || !exactKeys(record, allowed)) {
		throw new TypeError('Invalid Google token response');
	}
	const expiresIn = record.expires_in;
	const scopes = parseScopes(record.scope);
	const refreshToken = record.refresh_token ?? null;
	const idToken = record.id_token ?? null;
	if (
		!nonEmptySecret(record.access_token) ||
		!Number.isInteger(expiresIn) ||
		(expiresIn as number) < 1 ||
		(expiresIn as number) > 86400 ||
		record.token_type !== 'Bearer' ||
		scopes === null ||
		(refreshToken !== null && !nonEmptySecret(refreshToken)) ||
		(idToken !== null &&
			(typeof idToken !== 'string' ||
				idToken.length > 16384 ||
				!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(idToken))) ||
		(options.requireRefreshToken && refreshToken === null) ||
		(options.requireIdToken && idToken === null)
	) {
		throw new TypeError('Invalid Google token response');
	}
	return Object.freeze({
		accessToken: record.access_token,
		expiresIn: expiresIn as number,
		refreshToken: refreshToken as string | null,
		idToken: idToken as string | null,
		scopes
	});
}

export function parseGoogleIdentity(
	value: unknown,
	expected: { clientId: string; nonce: string; nowSeconds: number }
): GoogleIdentity {
	const record = objectRecord(value);
	const allowed = [
		'aud',
		'azp',
		'iss',
		'sub',
		'email',
		'email_verified',
		'exp',
		'iat',
		'nonce',
		'scope',
		'expires_in',
		'access_type'
	];
	const expiry = typeof record?.exp === 'string' ? Number(record.exp) : record?.exp;
	if (
		!record ||
		!exactKeys(record, allowed) ||
		record.aud !== validateClientId(expected.clientId) ||
		(record.iss !== 'https://accounts.google.com' && record.iss !== 'accounts.google.com') ||
		typeof record.sub !== 'string' ||
		!SUBJECT.test(record.sub) ||
		typeof record.email !== 'string' ||
		!EMAIL.test(record.email) ||
		(record.email_verified !== 'true' && record.email_verified !== true) ||
		record.nonce !== validateOAuthOpaqueValue(expected.nonce) ||
		!Number.isSafeInteger(expiry) ||
		!Number.isSafeInteger(expected.nowSeconds) ||
		(expiry as number) <= expected.nowSeconds
	) {
		throw new TypeError('Invalid Google identity response');
	}
	return Object.freeze({
		subject: record.sub,
		email: record.email.toLowerCase(),
		expiresAt: expiry as number
	});
}
