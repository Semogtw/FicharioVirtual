import { invokeNative, isNativeRuntime } from '$lib/platform/native-bridge';

export type NativeCacheTrimResult = Readonly<{
	beforeBytes: number;
	afterBytes: number;
	releasedBytes: number;
	evictedDocuments: number;
	protectedDocuments: number;
}>;

export async function trimNativeCache(targetBytes: number): Promise<NativeCacheTrimResult | null> {
	if (!isNativeRuntime()) return null;
	if (!Number.isSafeInteger(targetBytes) || targetBytes < 0) {
		throw new TypeError('targetBytes must be a non-negative safe integer');
	}
	return await invokeNative<NativeCacheTrimResult>('trim_native_cache', {
		request: { targetBytes }
	});
}
