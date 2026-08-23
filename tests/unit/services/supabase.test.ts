import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeAuthStorage } from '../../../src/lib/native/secure-storage';

const mocks = vi.hoisted(() => ({
	createClient: vi.fn()
}));

vi.mock('@supabase/supabase-js', () => ({
	createClient: mocks.createClient
}));

import { createBrowserSupabaseClient } from '../../../src/lib/services/supabase';

type MutableGlobal = typeof globalThis & {
	__TAURI__?: { core: { invoke: ReturnType<typeof vi.fn> } };
};

const root = globalThis as MutableGlobal;
const source = {
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_key_1234567890'
};

afterEach(() => {
	delete root.__TAURI__;
	mocks.createClient.mockReset();
});

describe('Supabase native auth configuration', () => {
	it('uses the native secure store and disables URL session detection in Tauri', () => {
		root.__TAURI__ = { core: { invoke: vi.fn() } };
		mocks.createClient.mockReturnValue({});

		createBrowserSupabaseClient(source);

		const [, , options] = mocks.createClient.mock.calls[0];
		expect(options.auth).toMatchObject({
			storage: nativeAuthStorage,
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: false
		});
	});

	it('keeps the web storage path and URL session detection outside Tauri', () => {
		mocks.createClient.mockReturnValue({});

		createBrowserSupabaseClient(source);

		const [, , options] = mocks.createClient.mock.calls[0];
		expect(options.auth).toMatchObject({
			storage: undefined,
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: true
		});
	});
});
