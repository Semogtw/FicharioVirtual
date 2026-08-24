import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	parseNativeOAuthCallbackUrl,
	NATIVE_OAUTH_CALLBACK_ORIGIN
} from '../../../src/lib/native/native-oauth-deep-link';
import { nativeOAuthReturnOrigin } from '../../../supabase/functions/_shared/cors';

describe('native OAuth deep link', () => {
	it('is installed by the native shell and removed with the shell lifecycle', () => {
		const shell = readFileSync('src/lib/components/AppShell.svelte', 'utf8');
		const capability = readFileSync('src-tauri/capabilities/default.json', 'utf8');

		expect(shell).toContain('installNativeOAuthDeepLinkListener');
		expect(shell).toContain('removeDeepLinkListener?.();');
		expect(capability).toContain('deep-link:default');
	});

	it('accepts only the configured app-link callback and returns the Drive result', () => {
		expect(NATIVE_OAUTH_CALLBACK_ORIGIN).toBe('https://fichario-virtual.pages.dev');
		expect(
			parseNativeOAuthCallbackUrl('https://fichario-virtual.pages.dev/settings/?drive=authorized')
		).toBe('authorized');
		expect(
			parseNativeOAuthCallbackUrl('https://fichario-virtual.pages.dev/settings/?drive=cancelled')
		).toBe('cancelled');
		expect(
			parseNativeOAuthCallbackUrl('https://fichario-virtual.pages.dev/settings/?drive=error')
		).toBe('error');
	});

	it('routes native OAuth callbacks through the verified HTTPS app link', () => {
		const oauthStart = readFileSync('supabase/functions/drive-oauth-start/index.ts', 'utf8');
		expect(oauthStart).toContain('nativeOAuthReturnOrigin');
		expect(oauthStart).toContain('const canonicalAppOrigin');
		expect(oauthStart).toContain('json(status, body, requestedAppOrigin)');
		expect(oauthStart).toContain('generateOAuthStateForOrigin(oauthReturnOrigin)');
		expect(
			nativeOAuthReturnOrigin('https://fichario-virtual.pages.dev', 'http://tauri.localhost')
		).toBe('https://fichario-virtual.pages.dev');
		expect(nativeOAuthReturnOrigin('https://fichario-virtual.pages.dev', 'tauri://localhost')).toBe(
			'https://fichario-virtual.pages.dev'
		);
		expect(
			nativeOAuthReturnOrigin('https://fichario-virtual.pages.dev', 'https://preview.example')
		).toBe('https://preview.example');
	});

	it('rejects lookalike origins, wrong paths, extra query data, and malformed URLs', () => {
		for (const value of [
			'https://evil.example/settings/?drive=authorized',
			'https://fichario-virtual.pages.dev.evil.example/settings/?drive=authorized',
			'https://fichario-virtual.pages.dev/login/?drive=authorized',
			'https://fichario-virtual.pages.dev/settings/?drive=authorized&next=https://evil.example',
			'not a URL'
		]) {
			expect(parseNativeOAuthCallbackUrl(value)).toBeNull();
		}
	});
});
