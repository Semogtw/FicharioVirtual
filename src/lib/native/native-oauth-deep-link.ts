export const NATIVE_OAUTH_CALLBACK_ORIGIN = 'https://fichario-virtual.pages.dev';
const NATIVE_OAUTH_CALLBACK_PATH = '/settings/';

export type NativeOAuthCallbackResult = 'authorized' | 'cancelled' | 'error';

export function parseNativeOAuthCallbackUrl(value: string | URL): NativeOAuthCallbackResult | null {
	let url: URL;
	try {
		url = typeof value === 'string' ? new URL(value) : value;
	} catch {
		return null;
	}
	if (
		url.origin !== NATIVE_OAUTH_CALLBACK_ORIGIN ||
		url.pathname !== NATIVE_OAUTH_CALLBACK_PATH ||
		url.hash.length > 0 ||
		url.searchParams.size !== 1
	) {
		return null;
	}
	const result = url.searchParams.get('drive');
	return result === 'authorized' || result === 'cancelled' || result === 'error' ? result : null;
}
