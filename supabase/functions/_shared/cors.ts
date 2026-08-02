const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function parseAppOrigin(value: string | undefined): string | null {
	const candidate = value?.trim();
	if (!candidate || candidate === '*') return null;

	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return null;
	}

	if (
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search.length > 0 ||
		url.hash.length > 0
	) {
		return null;
	}

	if (url.protocol === 'https:') return url.origin;
	if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return url.origin;
	return null;
}

export function corsHeaders(appOrigin: string | null): Record<string, string> {
	return {
		...(appOrigin ? { 'Access-Control-Allow-Origin': appOrigin } : {}),
		'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		Vary: 'Origin'
	};
}
