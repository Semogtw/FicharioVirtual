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
	it('stores only a hash of state before returning the Google authorization URL', () => {
		const source = readFileSync(startPath, 'utf8');

		expect(source).toContain('generateOAuthOpaqueValue');
		expect(source).toContain('hashOAuthState');
		expect(source).toMatch(rpc('store_drive_oauth_state'));
		expect(source).toContain('buildGoogleAuthorizationUrl');
		expect(source).not.toContain('refresh_token');
		expect(source).not.toContain('access_token');
	});

	it('consumes state, stores credentials, and bootstraps Drive before completing OAuth', () => {
		const source = readFileSync(callbackPath, 'utf8');
		const consumeIndex = source.search(rpc('consume_drive_oauth_state'));
		const exchangeIndex = source.indexOf('await requestInitialGoogleTokens', consumeIndex);
		const bootstrapIndex = source.indexOf('await bootstrapDriveRoot', exchangeIndex);
		const completeIndex = source.indexOf("'complete_drive_connection'", bootstrapIndex);

		expect(consumeIndex).toBeGreaterThan(0);
		expect(exchangeIndex).toBeGreaterThan(consumeIndex);
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

	it('disables platform JWT verification only for the Google redirect callback', () => {
		const config = readFileSync(configPath, 'utf8');
		const callback = configSection(config, 'drive-oauth-callback');
		const start = configSection(config, 'drive-oauth-start');
		const access = configSection(config, 'drive-access-token');

		expect(callback).toContain('verify_jwt = false');
		expect(start).toContain('verify_jwt = true');
		expect(access).toContain('verify_jwt = true');
	});
});
