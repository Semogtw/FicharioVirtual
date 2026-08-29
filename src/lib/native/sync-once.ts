import { invokeNative, isNativeRuntime } from '$lib/platform/native-bridge';

export const NATIVE_SYNC_ONCE_TIMEOUT_MS = 120_000;

export async function getNativeSyncOnceMode(): Promise<boolean> {
	if (!isNativeRuntime()) return false;
	const value = await invokeNative<unknown>('native_sync_once_mode');
	if (typeof value !== 'boolean') throw new TypeError('Invalid native sync-once mode');
	return value;
}

export async function finishNativeSyncOnce(): Promise<void> {
	if (!isNativeRuntime()) return;
	await invokeNative<void>('finish_native_sync_once');
}
