const STATIC_EXTENSION = /\.(?:css|js|mjs|svg|png|webp|avif|ico|woff2?|ttf|json|webmanifest)$/i;

export function shouldCachePublicAsset(url: URL, applicationOrigin: string): boolean {
	if (url.origin !== applicationOrigin) return false;
	if (
		url.pathname.startsWith('/auth/') ||
		url.pathname.startsWith('/rest/') ||
		url.pathname.startsWith('/storage/') ||
		url.pathname.startsWith('/functions/')
	) {
		return false;
	}
	return url.pathname.startsWith('/assets/') || STATIC_EXTENSION.test(url.pathname);
}
