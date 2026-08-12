import { describe, expect, it, vi } from 'vitest';
import {
	createOAuthPkceChallenge,
	generateOAuthOpaqueValue,
	generateOAuthStateForOrigin,
	hashOAuthState,
	isOAuthPkceVerifier,
	readOAuthStateOrigin,
	refreshGoogleAccessToken,
	requestInitialGoogleTokens,
	verifyGoogleIdToken
} from '../../../supabase/functions/_shared/google-oauth-http';
import { GOOGLE_DRIVE_FILE_SCOPE } from '../../../supabase/functions/_shared/google-oauth';

const clientId = '123456789012-example.apps.googleusercontent.com';
const clientSecret = 'google-client-secret-value';
const redirectUri = 'https://example.supabase.co/functions/v1/drive-oauth-callback';
const nonce = 'nonce_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('Google OAuth HTTP helpers', () => {
	it('generates URL-safe 256-bit state and a deterministic S256 PKCE challenge', async () => {
		const state = generateOAuthOpaqueValue(
			new Uint8Array(Array.from({ length: 32 }, (_, index) => index))
		);

		expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(state).not.toContain('=');
		expect(isOAuthPkceVerifier(state)).toBe(true);
		await expect(createOAuthPkceChallenge(codeVerifier)).resolves.toBe(codeChallenge);
		await expect(createOAuthPkceChallenge('short')).rejects.toThrow('Invalid OAuth PKCE verifier');
		await expect(hashOAuthState(state)).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
		await expect(hashOAuthState('short')).rejects.toThrow('Invalid OAuth opaque value');
	});

	it('binds an allowed application origin into OAuth state without weakening state entropy', () => {
		const bytes = new Uint8Array(Array.from({ length: 32 }, (_, index) => index));
		const origin = 'https://9c0556ff.fichario-virtual.pages.dev';
		const state = generateOAuthStateForOrigin(origin, bytes);

		expect(state).toMatch(/^[A-Za-z0-9_-]{44,128}$/);
		expect(state.endsWith(generateOAuthOpaqueValue(bytes))).toBe(true);
		expect(readOAuthStateOrigin(state)).toBe(origin);
		expect(readOAuthStateOrigin(generateOAuthOpaqueValue(bytes))).toBeNull();
		expect(readOAuthStateOrigin('x'.repeat(44))).toBeNull();
		expect(() =>
			generateOAuthStateForOrigin(`https://${'a'.repeat(63)}.fichario-virtual.pages.dev`, bytes)
		).toThrow('Invalid OAuth opaque value');
	});

	it('exchanges the authorization code with the exact PKCE form fields and strict tokens', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			jsonResponse({
				access_token: 'initial-access-token',
				expires_in: 3599,
				refresh_token: 'private-refresh-token',
				scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
				token_type: 'Bearer',
				id_token: 'header.payload.signature'
			})
		);

		const result = await requestInitialGoogleTokens({
			clientId,
			clientSecret,
			redirectUri,
			code: 'authorization-code-value',
			codeVerifier,
			fetchImpl
		});

		expect(result.refreshToken).toBe('private-refresh-token');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://oauth2.googleapis.com/token');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
		const body = new URLSearchParams(init.body);
		expect(Object.fromEntries(body)).toEqual({
			client_id: clientId,
			client_secret: clientSecret,
			code: 'authorization-code-value',
			code_verifier: codeVerifier,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri
		});
	});

	it('rejects an invalid PKCE verifier before contacting the token endpoint', async () => {
		const fetchImpl = vi.fn();
		await expect(
			requestInitialGoogleTokens({
				clientId,
				clientSecret,
				redirectUri,
				code: 'authorization-code-value',
				codeVerifier: 'short',
				fetchImpl
			})
		).rejects.toThrow('Invalid OAuth PKCE verifier');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('refreshes an access token without returning or accepting a new refresh token', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			jsonResponse({
				access_token: 'refreshed-access-token',
				expires_in: 3599,
				scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
				token_type: 'Bearer'
			})
		);

		const result = await refreshGoogleAccessToken({
			clientId,
			clientSecret,
			refreshToken: 'private-refresh-token',
			fetchImpl
		});

		expect(result).toEqual({ accessToken: 'refreshed-access-token', expiresIn: 3599 });
		const [, init] = fetchImpl.mock.calls[0];
		expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'refresh_token',
			refresh_token: 'private-refresh-token'
		});
	});

	it('verifies identity through tokeninfo and rejects provider errors or wrong nonce', async () => {
		const nowSeconds = 1_786_000_000;
		const fetchImpl = vi.fn().mockResolvedValue(
			jsonResponse({
				aud: clientId,
				iss: 'https://accounts.google.com',
				sub: 'google-user-subject-123456789',
				email: 'arthur@example.test',
				email_verified: 'true',
				exp: String(nowSeconds + 3600),
				nonce
			})
		);

		await expect(
			verifyGoogleIdToken({
				idToken: 'header.payload.signature',
				clientId,
				nonce,
				nowSeconds,
				fetchImpl
			})
		).resolves.toEqual({
			subject: 'google-user-subject-123456789',
			email: 'arthur@example.test',
			expiresAt: nowSeconds + 3600
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://oauth2.googleapis.com/tokeninfo?id_token=header.payload.signature',
			{ headers: { Accept: 'application/json' } }
		);

		fetchImpl.mockResolvedValueOnce(jsonResponse({ error: 'invalid_token' }, 400));
		await expect(
			verifyGoogleIdToken({
				idToken: 'header.payload.signature',
				clientId,
				nonce,
				nowSeconds,
				fetchImpl
			})
		).rejects.toThrow('Google OAuth request failed');
	});
});
