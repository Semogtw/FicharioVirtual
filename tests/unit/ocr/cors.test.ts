import { describe, expect, it } from 'vitest';
import { corsHeaders, parseAppOrigin } from '../../../supabase/functions/_shared/cors';

const cloudflareAllowlist =
	'https://staging.fichario-virtual.pages.dev,https://fichario-virtual.pages.dev,https://*.fichario-virtual.pages.dev';

describe('parseAppOrigin', () => {
	it('normalizes one HTTPS application origin', () => {
		expect(parseAppOrigin('https://fichario.example/')).toBe('https://fichario.example');
	});

	it('selects the exact requesting origin from a strict allowlist', () => {
		expect(parseAppOrigin(cloudflareAllowlist, 'https://staging.fichario-virtual.pages.dev')).toBe(
			'https://staging.fichario-virtual.pages.dev'
		);
		expect(parseAppOrigin(cloudflareAllowlist, 'https://fichario-virtual.pages.dev')).toBe(
			'https://fichario-virtual.pages.dev'
		);
		expect(parseAppOrigin(cloudflareAllowlist, 'https://9c0556ff.fichario-virtual.pages.dev')).toBe(
			'https://9c0556ff.fichario-virtual.pages.dev'
		);
	});

	it('keeps wildcard rules to exactly one HTTPS subdomain label', () => {
		expect(
			parseAppOrigin(cloudflareAllowlist, 'https://nested.preview.fichario-virtual.pages.dev')
		).toBeNull();
		expect(
			parseAppOrigin(cloudflareAllowlist, 'https://fichario-virtual.pages.dev.evil.test')
		).toBeNull();
		expect(parseAppOrigin(cloudflareAllowlist, 'https://unrelated.pages.dev')).toBeNull();
	});

	it('uses the first exact origin as the canonical server-side fallback', () => {
		expect(parseAppOrigin(cloudflareAllowlist)).toBe('https://staging.fichario-virtual.pages.dev');
		expect(parseAppOrigin('https://*.fichario-virtual.pages.dev')).toBeNull();
	});

	it('allows HTTP only for local development origins', () => {
		expect(parseAppOrigin('http://localhost:5173')).toBe('http://localhost:5173');
		expect(parseAppOrigin('http://127.0.0.1:4173/')).toBe('http://127.0.0.1:4173');
		expect(parseAppOrigin('http://fichario.example')).toBeNull();
	});

	it('rejects wildcard-all, malformed allowlists, credentials, paths, query strings and fragments', () => {
		for (const value of [
			undefined,
			'',
			'*',
			'https://fichario.example,',
			'https://*.*.example.test',
			'https://user:secret@fichario.example',
			'https://fichario.example/app',
			'https://fichario.example?mode=test',
			'https://fichario.example#fragment'
		]) {
			expect(parseAppOrigin(value)).toBeNull();
		}
	});
});

describe('corsHeaders', () => {
	it('returns the exact configured origin and never a wildcard', () => {
		const headers = corsHeaders('https://fichario.example');

		expect(headers['Access-Control-Allow-Origin']).toBe('https://fichario.example');
		expect(headers['Access-Control-Allow-Origin']).not.toBe('*');
		expect(headers.Vary).toBe('Origin');
	});

	it('allows the current Supabase browser request headers explicitly', () => {
		const headers = corsHeaders('https://fichario.example');
		const allowed = new Set(
			(headers['Access-Control-Allow-Headers'] ?? '')
				.split(',')
				.map((header) => header.trim().toLowerCase())
		);

		for (const header of [
			'authorization',
			'apikey',
			'content-type',
			'x-client-info',
			'x-supabase-api-version'
		]) {
			expect(allowed.has(header)).toBe(true);
		}
	});

	it('omits the allow-origin header when configuration is unavailable', () => {
		const headers = corsHeaders(null);

		expect(headers).not.toHaveProperty('Access-Control-Allow-Origin');
		expect(headers.Vary).toBe('Origin');
	});
});
