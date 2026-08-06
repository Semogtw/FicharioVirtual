import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const startPath = 'supabase/functions/drive-oauth-start/index.ts';
const callbackPath = 'supabase/functions/drive-oauth-callback/index.ts';
const accessPath = 'supabase/functions/drive-access-token/index.ts';
const configPath = 'supabase/config.toml';

describe('Drive OAuth Edge Function boundaries', () => {
	it('stores only a hash of state before returning the Google authorization URL', () => {
		const source = readFileSync(startPath, 'utf8');

		expect(source).toContain('generateOAuthOpaqueValue');
		expect(source).toContain('hashOAuthState');
		expect(source).toContain("rpc('store_drive_oauth_state'");
		expect(source).toContain('buildGoogleAuthorizationUrl');
		expect(source).not.toContain('refresh_token');
		expect(source).not.toContain('access_token');
	});

	it('consumes state, stores credentials, and bootstraps Drive before completing OAuth', () => {
		const source = readFileSync(callbackPath, 'utf8');
		const consumeIndex = source.indexOf("rpc('consume_drive_oauth_state'");
		const exchangeIndex = source.indexOf('requestInitialGoogleTokens');
		const bootstrapIndex = source.indexOf('bootstrapDriveRoot');
		const completeIndex = source.indexOf("rpc('complete_drive_connection'");

		expect(consumeIndex).toBeGreaterThan(0);
		expect(exchangeIndex).toBeGreaterThan(consumeIndex);
		expect(source).toContain("rpc('store_drive_credential'");
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
		expect(source).toContain("rpc('get_drive_refresh_token'");
		expect(source).toContain('refreshGoogleAccessToken');
		expect(source).toContain("'Cache-Control': 'no-store'");
		expect(source).toContain('accessToken: refreshed.accessToken');
		expect(source).not.toContain('refreshToken:');
	});

	it('disables platform JWT verification only for the Google redirect callback', () => {
		const config = readFileSync(configPath, 'utf8');

		expect(config).toContain('[functions.drive-oauth-callback]');
		expect(config).toMatch(/\[functions\.drive-oauth-callback\][\s\S]*?verify_jwt = false/);
		expect(config).not.toMatch(
			/\[functions\.drive-oauth-start\][\s\S]*?verify_jwt = false/
		);
		expect(config).not.toMatch(
			/\[functions\.drive-access-token\][\s\S]*?verify_jwt = false/
		);
	});
});
