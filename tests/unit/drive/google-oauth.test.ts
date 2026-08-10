import { describe, expect, it } from 'vitest';
import {
	GOOGLE_DRIVE_FILE_SCOPE,
	buildGoogleAuthorizationUrl,
	parseGoogleIdentity,
	parseGoogleTokenResponse,
	validateOAuthOpaqueValue
} from '../../../supabase/functions/_shared/google-oauth';

const clientId = '123456789012-example.apps.googleusercontent.com';
const redirectUri = 'https://example.supabase.co/functions/v1/drive-oauth-callback';
const state = 'state_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const nonce = 'nonce_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('Google Drive OAuth contracts', () => {
	it('builds an authorization URL with only identity, drive.file, and S256 PKCE parameters', () => {
		const value = buildGoogleAuthorizationUrl({
			clientId,
			redirectUri,
			state,
			nonce,
			codeChallenge
		});
		const url = new URL(value);

		expect(url.origin).toBe('https://accounts.google.com');
		expect(url.pathname).toBe('/o/oauth2/v2/auth');
		expect(url.searchParams.get('client_id')).toBe(clientId);
		expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('access_type')).toBe('offline');
		expect(url.searchParams.get('prompt')).toBe('consent');
		expect(url.searchParams.get('state')).toBe(state);
		expect(url.searchParams.get('nonce')).toBe(nonce);
		expect(url.searchParams.get('code_challenge')).toBe(codeChallenge);
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('scope')?.split(' ')).toEqual([
			'openid',
			'email',
			GOOGLE_DRIVE_FILE_SCOPE
		]);
		expect([...url.searchParams.keys()].sort()).toEqual(
			[
				'access_type',
				'client_id',
				'code_challenge',
				'code_challenge_method',
				'include_granted_scopes',
				'nonce',
				'prompt',
				'redirect_uri',
				'response_type',
				'scope',
				'state'
			].sort()
		);
	});

	it('rejects malformed client, redirect, state, nonce, challenge, and scope expansion', () => {
		expect(() =>
			buildGoogleAuthorizationUrl({
				clientId: 'not-a-client',
				redirectUri,
				state,
				nonce,
				codeChallenge
			})
		).toThrow('Invalid Google OAuth configuration');
		expect(() =>
			buildGoogleAuthorizationUrl({
				clientId,
				redirectUri: 'http://example.supabase.co/functions/v1/drive-oauth-callback',
				state,
				nonce,
				codeChallenge
			})
		).toThrow('Invalid Google OAuth configuration');
		expect(() =>
			buildGoogleAuthorizationUrl({ clientId, redirectUri, state, nonce, codeChallenge: 'short' })
		).toThrow('Invalid OAuth PKCE challenge');
		expect(() => validateOAuthOpaqueValue('short')).toThrow('Invalid OAuth opaque value');
		expect(() => validateOAuthOpaqueValue(`${state}.bad`)).toThrow('Invalid OAuth opaque value');
	});

	it('parses the initial token response strictly and requires a refresh token', () => {
		const parsed = parseGoogleTokenResponse(
			{
				access_token: 'access-token-value',
				expires_in: 3599,
				refresh_token: 'refresh-token-value',
				scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
				token_type: 'Bearer',
				id_token: 'header.payload.signature'
			},
			{ requireRefreshToken: true, requireIdToken: true }
		);

		expect(parsed.refreshToken).toBe('refresh-token-value');
		expect(parsed.scopes).toEqual(['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE]);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(() =>
			parseGoogleTokenResponse(
				{
					access_token: 'access-token-value',
					expires_in: 3599,
					scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
					token_type: 'Bearer',
					id_token: 'header.payload.signature'
				},
				{ requireRefreshToken: true, requireIdToken: true }
			)
		).toThrow('Invalid Google token response');
		expect(() =>
			parseGoogleTokenResponse(
				{
					access_token: 'access-token-value',
					expires_in: 3599,
					refresh_token: 'refresh-token-value',
					scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE} https://www.googleapis.com/auth/drive`,
					token_type: 'Bearer',
					id_token: 'header.payload.signature'
				},
				{ requireRefreshToken: true, requireIdToken: true }
			)
		).toThrow('Invalid Google token response');
	});

	it('parses verified tokeninfo identity and checks audience, issuer, nonce and expiry', () => {
		const nowSeconds = 1_786_000_000;
		const parsed = parseGoogleIdentity(
			{
				aud: clientId,
				iss: 'https://accounts.google.com',
				sub: 'google-user-subject-123456789',
				email: 'arthur@example.test',
				email_verified: 'true',
				exp: String(nowSeconds + 3600),
				nonce
			},
			{ clientId, nonce, nowSeconds }
		);

		expect(parsed).toEqual({
			subject: 'google-user-subject-123456789',
			email: 'arthur@example.test',
			expiresAt: nowSeconds + 3600
		});
		expect(() =>
			parseGoogleIdentity(
				{
					aud: 'other.apps.googleusercontent.com',
					iss: 'https://accounts.google.com',
					sub: 'google-user-subject-123456789',
					email: 'arthur@example.test',
					email_verified: 'true',
					exp: String(nowSeconds + 3600),
					nonce
				},
				{ clientId, nonce, nowSeconds }
			)
		).toThrow('Invalid Google identity response');
		expect(() =>
			parseGoogleIdentity(
				{
					aud: clientId,
					iss: 'https://accounts.google.com',
					sub: 'google-user-subject-123456789',
					email: 'arthur@example.test',
					email_verified: 'true',
					exp: String(nowSeconds - 1),
					nonce
				},
				{ clientId, nonce, nowSeconds }
			)
		).toThrow('Invalid Google identity response');
	});
});
