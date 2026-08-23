import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeAuthStorage } from '../../../src/lib/native/secure-storage';

type MutableGlobal = typeof globalThis & {
	__TAURI__?: { core: { invoke: ReturnType<typeof vi.fn> } };
};

const root = globalThis as MutableGlobal;

afterEach(() => {
	delete root.__TAURI__;
	vi.restoreAllMocks();
});

describe('native secure auth storage', () => {
	it('uses the native commands for the Supabase storage lifecycle', async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce('{"access_token":"secret"}')
			.mockResolvedValue(undefined);
		root.__TAURI__ = { core: { invoke } };

		await expect(nativeAuthStorage.getItem('sb-example-auth-token')).resolves.toBe(
			'{"access_token":"secret"}'
		);
		await nativeAuthStorage.setItem('sb-example-auth-token', '{"access_token":"next"}');
		await nativeAuthStorage.removeItem('sb-example-auth-token');

		expect(invoke).toHaveBeenNthCalledWith(1, 'native_secure_storage_get', {
			request: { key: 'sb-example-auth-token' }
		});
		expect(invoke).toHaveBeenNthCalledWith(2, 'native_secure_storage_set', {
			request: { key: 'sb-example-auth-token', value: '{"access_token":"next"}' }
		});
		expect(invoke).toHaveBeenNthCalledWith(3, 'native_secure_storage_remove', {
			request: { key: 'sb-example-auth-token' }
		});
	});

	it('rejects malformed keys and native responses', async () => {
		const invoke = vi.fn().mockResolvedValue({ value: 42 });
		root.__TAURI__ = { core: { invoke } };

		await expect(nativeAuthStorage.getItem('localStorage')).rejects.toThrow(
			'Invalid native secure storage key'
		);
		await expect(nativeAuthStorage.getItem('sb-example-auth-token')).rejects.toThrow(
			'Invalid native secure storage value'
		);
		expect(invoke).toHaveBeenCalledTimes(1);
	});

	it('does not fall back to web storage when the native runtime is unavailable', async () => {
		await expect(nativeAuthStorage.getItem('sb-example-auth-token')).rejects.toThrow(
			'O runtime nativo do Fichário não está disponível.'
		);
	});
});
