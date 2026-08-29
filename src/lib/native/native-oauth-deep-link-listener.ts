import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { isNativeRuntime } from '$lib/platform/native-bridge';
import { parseNativeOAuthCallbackUrl } from '$lib/native/native-oauth-deep-link';

function handleUrls(urls: readonly string[]) {
	for (const candidate of urls) {
		const result = parseNativeOAuthCallbackUrl(candidate);
		if (result === null) continue;
		void navigateToOAuthResult(result);
		return;
	}
}

async function navigateToOAuthResult(
	result: NonNullable<ReturnType<typeof parseNativeOAuthCallbackUrl>>
) {
	try {
		await goto(resolve(`/settings/?drive=${result}`), { replaceState: true });
	} catch {
		// The app may be closing while an external browser finishes OAuth.
	}
}

export async function installNativeOAuthDeepLinkListener(): Promise<() => void> {
	if (!isNativeRuntime()) return () => undefined;
	const unlisten = await onOpenUrl((urls) => handleUrls(urls));
	const initialUrls = await getCurrent();
	if (initialUrls) handleUrls(initialUrls);
	return unlisten;
}
