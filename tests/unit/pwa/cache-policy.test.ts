import { describe, expect, it } from 'vitest';
import { shouldCachePublicAsset } from '../../../src/lib/pwa/cache-policy';

describe('PWA cache policy', () => {
	it('caches only same-origin static assets', () => {
		expect(
			shouldCachePublicAsset(new URL('https://app.test/assets/app.js'), 'https://app.test')
		).toBe(true);
		expect(
			shouldCachePublicAsset(new URL('https://app.test/favicon.svg'), 'https://app.test')
		).toBe(true);
		expect(shouldCachePublicAsset(new URL('https://app.test/library/'), 'https://app.test')).toBe(
			false
		);
	});

	it('never caches Supabase APIs, storage or Edge Functions', () => {
		for (const url of [
			'https://project.supabase.co/rest/v1/documents',
			'https://project.supabase.co/storage/v1/object/sign/documents/file',
			'https://project.supabase.co/functions/v1/process-ocr',
			'https://project.supabase.co/auth/v1/token'
		]) {
			expect(shouldCachePublicAsset(new URL(url), 'https://app.test')).toBe(false);
		}
	});
});
