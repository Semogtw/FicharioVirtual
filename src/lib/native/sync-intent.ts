import { invokeNative, isNativeRuntime } from '$lib/platform/native-bridge';

function request(documentId: string) {
	return { request: { documentId } } as const;
}

export async function ensureNativeUploadIntent(documentId: string): Promise<boolean> {
	if (!isNativeRuntime()) return false;
	return await invokeNative<boolean>('ensure_native_upload_intent', request(documentId));
}

export async function cancelNativeUploadIntent(documentId: string): Promise<boolean> {
	if (!isNativeRuntime()) return false;
	return await invokeNative<boolean>('cancel_native_upload_intent', request(documentId));
}
