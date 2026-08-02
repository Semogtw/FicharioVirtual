import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const headers = readFileSync(new URL('../../../static/_headers', import.meta.url), 'utf8');

describe('static security headers', () => {
	it('blocks framing, sniffing and broad external connections', () => {
		expect(headers).toContain("frame-ancestors 'none'");
		expect(headers).toContain('X-Content-Type-Options: nosniff');
		expect(headers).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
		expect(headers).not.toContain('connect-src *');
	});

	it('permits workers and WASM without enabling arbitrary inline scripts', () => {
		expect(headers).toContain("worker-src 'self' blob:");
		expect(headers).toContain("script-src 'self' 'wasm-unsafe-eval'");
		expect(headers).not.toContain("script-src 'self' 'unsafe-inline'");
	});

	it('disables sensitive browser capabilities that the app does not use', () => {
		expect(headers).toContain(
			'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
		);
		expect(headers).not.toContain('camera=(self)');
	});
});
