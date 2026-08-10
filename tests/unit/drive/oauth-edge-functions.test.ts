import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const startPath = 'supabase/functions/drive-oauth-start/index.ts';
const callbackPath = 'supabase/functions/drive-oauth-callback/index.ts';
const accessPath = 'supabase/functions/drive-access-token/index.ts';
const configPath = 'supabase/config.toml';
const rpc = (name: string) => new RegExp(`rpc\\(\\s*['"]${name}['"]`);

function configSection(config: string, name: string) {
	const marker = `[functions.${name}]`;
	const start = config.indexOf(marker);
	if (start < 0) return '';
	const remainder = config.slice(start + marker.length);
	const next = remainder.search(/\n\[/);
	return next < 0 ? remainder : remainder.slice(0, next);
}

describe('Drive OAuth Edge Function boundaries', () => {
	it('stores only a hash of state plus a backend PKCE verifier before returning the authorization URL', () => {
		const source = readFileSync(startPath, 'utf8');

		expect(source).toContain('generateOAuthOpaqueValue');
		expect(source).toContain('hashOAuthState');
		expect(source).toContain('createOAuthPkceChallenge');
		expect(source).toMatch(rpc('store_drive_oauth_state_pkce'));
		expect(source).not.toMatch(rpc('store_drive_oauth_state'));
		expect(source).toContain('target_code_verifier: codeVerifier');
		expect(source).toContain('buildGoogleAuthorizationUrl');
		expect(source).toContain('codeChallenge');
		expect(source).toContain('return respond(200, { authorizationUrl })');
		expect(source).not.toContain('return respond(200, { authorizationUrl, codeVerifier');
		expect(source).not.toContain('refresh_token');
		expect(source).not.toContain('access_token');
	});

	it('consumes the PKCE-bound state before token exchange and keeps verifier backend-only', () => {
		const source = readFileSync(callbackPath, 'utf8');
		const consumeIndex = source.search(rpc('consume_drive_oauth_state_pkce'));
		const exchangeIndex = source.indexOf('await requestInitialGoogleTokens', consumeIndex);
		const bootstrapIndex = source.indexOf('await bootstrapDriveRoot', exchangeIndex);
		const completeIndex = source.indexOf("'complete_drive_connection'", bootstrapIndex);

		expect(consumeIndex).toBeGreaterThan(0);
		expect(source).not.toMatch(rpc('consume_drive_oauth_state'));
		expect(source).toContain('Object.keys(record).length !== 3');
		expect(source).toContain('isOAuthPkceVerifier(record.code_verifier)');
		expect(exchangeIndex).toBeGreaterThan(consumeIndex);
		expect(source).toContain('codeVerifier: verifiedState.codeVerifier');
		expect(source).toMatch(rpc('store_drive_credential'));
		expect(source).toContain('verifyGoogleIdToken');
		expect(bootstrapIndex).toBeGreaterThan(exchangeIndex);
		expect(completeIndex).toBeGreaterThan(bootstrapIndex);
		expect(source).toContain("'Cache-Control': 'no-store'");
		expect(source).not.toContain('JSON.stringify(tokens)');
		expect(source).not.toContain('JSON.stringify(token)');
	});

	it('returns only an ephemeral access token after authenticating the Fichário user', () => {
		const source = readFileSync(accessPath, 'utf8');

		expect(source).toContain('auth.getUser()');
		expect(source).toMatch(rpc('get_drive_refresh_token'));
		expect(source).toContain('refreshGoogleAccessToken');
		expect(source).toContain("'Cache-Control': 'no-store'");
		expect(source).toContain('accessToken: refreshed.accessToken');
		expect(source).not.toContain('refreshToken:');
	});

	it('keeps the callback gateway exception explicit while authenticated entrypoints still require JWT', () => {
		const config = readFileSync(configPath, 'utf8');
		const callback = configSection(config, 'drive-oauth-callback');
		const start = configSection(config, 'drive-oauth-start');
		const access = configSection(config, 'drive-access-token');

		expect(callback).toContain('verify_jwt = false');
		expect(start).toContain('verify_jwt = true');
		expect(access).toContain('verify_jwt = true');
	});
});
