import { invokeNative, isNativeRuntime } from '$lib/platform/native-bridge';

export async function openNativeOAuthUrl(url: string): Promise<void> {
	if (!isNativeRuntime()) throw new Error('Native OAuth opener is unavailable in the web runtime.');
	await invokeNative<void>('open_native_oauth_url', { request: { url } });
}
