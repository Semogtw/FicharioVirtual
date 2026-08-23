import { invokeNative, isNativeRuntime } from '$lib/platform/native-bridge';

const MAX_STORAGE_KEY_LENGTH = 256;
const MAX_STORAGE_VALUE_BYTES = 64 * 1024;
const SUPABASE_STORAGE_KEY = /^sb-[A-Za-z0-9._:-]{1,253}$/;

function validStorageKey(key: string) {
	return key.length <= MAX_STORAGE_KEY_LENGTH && SUPABASE_STORAGE_KEY.test(key);
}

function assertStorageKey(key: string) {
	if (typeof key !== 'string' || !validStorageKey(key)) {
		throw new TypeError('Invalid native secure storage key');
	}
}

function assertStorageValue(value: string) {
	if (
		typeof value !== 'string' ||
		new TextEncoder().encode(value).byteLength > MAX_STORAGE_VALUE_BYTES
	) {
		throw new TypeError('Invalid native secure storage value');
	}
}

function parseStorageValue(value: unknown): string | null {
	if (
		value !== null &&
		(typeof value !== 'string' ||
			new TextEncoder().encode(value).byteLength > MAX_STORAGE_VALUE_BYTES)
	) {
		throw new TypeError('Invalid native secure storage value');
	}
	return value as string | null;
}

function assertNativeRuntime() {
	if (!isNativeRuntime()) {
		throw new Error('O runtime nativo do Fichário não está disponível.');
	}
}

export const nativeAuthStorage = Object.freeze({
	async getItem(key: string): Promise<string | null> {
		assertNativeRuntime();
		assertStorageKey(key);
		const value = await invokeNative<unknown>('native_secure_storage_get', { request: { key } });
		return parseStorageValue(value);
	},

	async setItem(key: string, value: string): Promise<void> {
		assertNativeRuntime();
		assertStorageKey(key);
		assertStorageValue(value);
		await invokeNative<void>('native_secure_storage_set', { request: { key, value } });
	},

	async removeItem(key: string): Promise<void> {
		assertNativeRuntime();
		assertStorageKey(key);
		await invokeNative<void>('native_secure_storage_remove', { request: { key } });
	}
});
