import {
	buildGoogleAuthorizationUrl,
	parseGoogleIdentity,
	parseGoogleTokenResponse,
	validateOAuthOpaqueValue,
	type GoogleIdentity,
	type GoogleTokenResponse
} from './google-oauth.ts';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function validateSecret(value: string, label: string): string {
	if (
		value.length < 8 ||
		value.length > 8192 ||
		[...value].some((character) => {
			const code = character.codePointAt(0);
			return code !== undefined && (code < 32 || code === 127);
		})
	) {
		throw new TypeError(`Invalid ${label}`);
	}
	return value;
}

export function isOAuthPkceVerifier(value: unknown): value is string {
	return typeof value === 'string' && PKCE_VERIFIER.test(value);
}

async function sha256Base64Url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return base64Url(new Uint8Array(digest));
}

export async function createOAuthPkceChallenge(codeVerifier: string): Promise<string> {
	if (!isOAuthPkceVerifier(codeVerifier)) throw new TypeError('Invalid OAuth PKCE verifier');
	return sha256Base64Url(codeVerifier);
}

function validateOAuthConfiguration(clientId: string, redirectUri: string): void {
	buildGoogleAuthorizationUrl({
		clientId,
		redirectUri,
		state: 's'.repeat(43),
		nonce: 'n'.repeat(43),
		codeChallenge: 'c'.repeat(43)
	});
}

async function responseJson(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error('Google OAuth request failed');
	const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
	if (!contentType.includes('application/json')) throw new Error('Google OAuth request failed');
	try {
		return await response.json();
	} catch {
		throw new Error('Google OAuth request failed');
	}
}

export function generateOAuthOpaqueValue(bytes?: Uint8Array): string {
	const source = bytes ?? crypto.getRandomValues(new Uint8Array(32));
	if (!(source instanceof Uint8Array) || source.byteLength !== 32) {
		throw new TypeError('Invalid OAuth random source');
	}
	return validateOAuthOpaqueValue(base64Url(source));
}

export async function hashOAuthState(state: string): Promise<string> {
	return sha256Base64Url(validateOAuthOpaqueValue(state));
}

export async function requestInitialGoogleTokens({
	clientId,
	clientSecret,
	redirectUri,
	code,
	codeVerifier,
	fetchImpl = fetch
}: {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	code: string;
	codeVerifier: string;
	fetchImpl?: FetchLike;
}): Promise<GoogleTokenResponse> {
	validateOAuthConfiguration(clientId, redirectUri);
	if (!isOAuthPkceVerifier(codeVerifier)) throw new TypeError('Invalid OAuth PKCE verifier');
	const body = new URLSearchParams({
		client_id: clientId,
		client_secret: validateSecret(clientSecret, 'Google client secret'),
		code: validateSecret(code, 'Google authorization code'),
		code_verifier: codeVerifier,
		grant_type: 'authorization_code',
		redirect_uri: redirectUri
	});
	const response = await fetchImpl('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});
	return parseGoogleTokenResponse(await responseJson(response), {
		requireRefreshToken: true,
		requireIdToken: true
	});
}

export async function refreshGoogleAccessToken({
	clientId,
	clientSecret,
	refreshToken,
	fetchImpl = fetch
}: {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
	fetchImpl?: FetchLike;
}): Promise<Readonly<{ accessToken: string; expiresIn: number }>> {
	validateOAuthConfiguration(
		clientId,
		'https://example.supabase.co/functions/v1/drive-oauth-callback'
	);
	const body = new URLSearchParams({
		client_id: clientId,
		client_secret: validateSecret(clientSecret, 'Google client secret'),
		grant_type: 'refresh_token',
		refresh_token: validateSecret(refreshToken, 'Google refresh token')
	});
	const response = await fetchImpl('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});
	const token = parseGoogleTokenResponse(await responseJson(response), {
		requireRefreshToken: false,
		requireIdToken: false
	});
	return Object.freeze({ accessToken: token.accessToken, expiresIn: token.expiresIn });
}

export async function verifyGoogleIdToken({
	idToken,
	clientId,
	nonce,
	nowSeconds,
	fetchImpl = fetch
}: {
	idToken: string;
	clientId: string;
	nonce: string;
	nowSeconds: number;
	fetchImpl?: FetchLike;
}): Promise<GoogleIdentity> {
	validateSecret(idToken, 'Google ID token');
	const url = new URL('https://oauth2.googleapis.com/tokeninfo');
	url.searchParams.set('id_token', idToken);
	const response = await fetchImpl(url.toString(), {
		headers: { Accept: 'application/json' }
	});
	return parseGoogleIdentity(await responseJson(response), { clientId, nonce, nowSeconds });
}
