import { describe, expect, it } from 'vitest';
import { corsHeaders, parseAppOrigin } from '../../../supabase/functions/_shared/cors';

describe('parseAppOrigin', () => {
	it('normalizes one HTTPS application origin', () => {
		expect(parseAppOrigin('https://fichario.example/')).toBe('https://fichario.example');
	});

	it('allows HTTP only for local development origins', () => {
		expect(parseAppOrigin('http://localhost:5173')).toBe('http://localhost:5173');
		expect(parseAppOrigin('http://127.0.0.1:4173/')).toBe('http://127.0.0.1:4173');
		expect(parseAppOrigin('http://fichario.example')).toBeNull();
	});

	it('rejects wildcard, credentials, paths, query strings and fragments', () => {
		for (const value of [
			undefined,
			'',
			'*',
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

	it('omits the allow-origin header when configuration is unavailable', () => {
		const headers = corsHeaders(null);

		expect(headers).not.toHaveProperty('Access-Control-Allow-Origin');
		expect(headers.Vary).toBe('Origin');
	});
});
