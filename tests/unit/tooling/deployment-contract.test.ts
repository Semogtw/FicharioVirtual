import { describe, expect, it } from 'vitest';
import {
	assertAppShell,
	assertHttpRedirect,
	assertManifest,
	assertSecurityHeaders,
	assertServiceWorker,
	parseDeploymentUrl
} from '../../../tools/checks/deployment-contract.mjs';

function secureHeaders(overrides: Record<string, string> = {}) {
	return new Headers({
		'content-security-policy':
			"default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
		'strict-transport-security': 'max-age=31536000; includeSubDomains',
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
		'x-frame-options': 'DENY',
		'permissions-policy': 'camera=(), microphone=(), geolocation=()',
		'cross-origin-opener-policy': 'same-origin',
		'cross-origin-resource-policy': 'same-origin',
		...overrides
	});
}

describe('deployment contract', () => {
	it('accepts only clean HTTPS deployment origins', () => {
		expect(parseDeploymentUrl('https://archive.example.test')).toEqual(
			new URL('https://archive.example.test/')
		);
		expect(() => parseDeploymentUrl('http://archive.example.test')).toThrow(/HTTPS/);
		expect(() => parseDeploymentUrl('https://user:secret@archive.example.test')).toThrow(
			/credentials/
		);
		expect(() => parseDeploymentUrl('https://archive.example.test/?preview=true')).toThrow(
			/query/
		);
	});

	it('requires the security headers promised by the static host contract', () => {
		expect(() => assertSecurityHeaders(secureHeaders())).not.toThrow();
		expect(() =>
			assertSecurityHeaders(secureHeaders({ 'content-security-policy': "default-src 'self'" }))
		).toThrow(/object-src/);
		expect(() => assertSecurityHeaders(secureHeaders({ 'x-frame-options': 'SAMEORIGIN' }))).toThrow(
			/X-Frame-Options/
		);
	});

	it('checks the generated app shell and manifest', () => {
		const html = `<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest"><script src="/registerSW.js" defer></script></head><body><div id="app"></div></body></html>`;
		expect(() => assertAppShell(html)).not.toThrow();
		expect(() => assertAppShell('<html><body></body></html>')).toThrow(/manifest/);

		expect(() =>
			assertManifest({
				name: 'Fichário Virtual',
				short_name: 'Fichário',
				start_url: '/',
				display: 'standalone',
				icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
			})
		).not.toThrow();
		expect(() => assertManifest({ name: 'Fichário Virtual', start_url: '/', display: 'browser' })).toThrow(
			/standalone/
		);
	});

	it('rejects service workers that mention authenticated API surfaces', () => {
		expect(() =>
			assertServiceWorker("self.addEventListener('fetch', () => {}); precacheAndRoute([]);")
		).not.toThrow();
		expect(() => assertServiceWorker("fetch('/rest/v1/documents')")).toThrow(/private API/);
		expect(() => assertServiceWorker('fetch("https://example.supabase.co")')).toThrow(/Supabase/);
	});

	it('requires the cleartext origin to redirect to the same HTTPS host', () => {
		const baseUrl = new URL('https://archive.example.test/');
		expect(() =>
			assertHttpRedirect(baseUrl, 308, 'https://archive.example.test/login')
		).not.toThrow();
		expect(() => assertHttpRedirect(baseUrl, 200, null)).toThrow(/redirect/);
		expect(() => assertHttpRedirect(baseUrl, 302, 'https://other.example.test/')).toThrow(/same host/);
	});
});
