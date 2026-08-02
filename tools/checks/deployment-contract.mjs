function fail(message) {
	throw new Error(`Deployment contract failed: ${message}`);
}

function requireHeader(headers, name) {
	const value = headers.get(name);
	if (!value) fail(`missing ${name} header`);
	return value;
}

export function parseDeploymentUrl(value) {
	if (typeof value !== 'string' || value.trim() === '') {
		fail('deployment URL is required');
	}

	let url;
	try {
		url = new URL(value);
	} catch {
		fail('deployment URL is invalid');
	}

	if (url.protocol !== 'https:') fail('deployment URL must use HTTPS');
	if (url.username || url.password) fail('deployment URL must not contain credentials');
	if (url.search) fail('deployment URL must not contain a query string');
	if (url.hash) fail('deployment URL must not contain a fragment');
	if (url.pathname !== '/' && url.pathname !== '') {
		fail('deployment URL must point to the site origin, not a nested path');
	}

	return new URL(`${url.origin}/`);
}

export function assertSecurityHeaders(headers) {
	const csp = requireHeader(headers, 'content-security-policy');
	for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) {
		if (!csp.includes(directive)) fail(`Content-Security-Policy must include ${directive}`);
	}

	const hsts = requireHeader(headers, 'strict-transport-security');
	if (!/max-age=\d+/i.test(hsts)) fail('Strict-Transport-Security must define max-age');

	if (requireHeader(headers, 'referrer-policy').toLowerCase() !== 'no-referrer') {
		fail('Referrer-Policy must be no-referrer');
	}
	if (requireHeader(headers, 'x-content-type-options').toLowerCase() !== 'nosniff') {
		fail('X-Content-Type-Options must be nosniff');
	}
	if (requireHeader(headers, 'x-frame-options').toUpperCase() !== 'DENY') {
		fail('X-Frame-Options must be DENY');
	}

	const permissions = requireHeader(headers, 'permissions-policy');
	for (const capability of ['camera=()', 'microphone=()', 'geolocation=()']) {
		if (!permissions.includes(capability)) fail(`Permissions-Policy must disable ${capability}`);
	}

	if (requireHeader(headers, 'cross-origin-opener-policy').toLowerCase() !== 'same-origin') {
		fail('Cross-Origin-Opener-Policy must be same-origin');
	}
	if (requireHeader(headers, 'cross-origin-resource-policy').toLowerCase() !== 'same-origin') {
		fail('Cross-Origin-Resource-Policy must be same-origin');
	}
}

export function assertAppShell(html) {
	if (typeof html !== 'string' || html.trim() === '') fail('app shell HTML is empty');
	if (!/<link[^>]+rel=["']manifest["'][^>]+href=["']\/manifest\.webmanifest["']/i.test(html)) {
		fail('app shell does not reference the web manifest');
	}
	if (!/<script[^>]+src=["']\/registerSW\.js["'][^>]*\bdefer\b[^>]*><\/script>/i.test(html)) {
		fail('app shell does not load the deferred external service-worker registrar');
	}
}

export function assertManifest(manifest) {
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		fail('web manifest is not a JSON object');
	}
	if (manifest.name !== 'Fichário Virtual') fail('web manifest name is unexpected');
	if (manifest.start_url !== '/') fail('web manifest start_url must be /');
	if (manifest.display !== 'standalone') fail('web manifest display must be standalone');
	if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
		fail('web manifest must provide at least one icon');
	}
	for (const icon of manifest.icons) {
		if (!icon || typeof icon.src !== 'string' || !icon.src.startsWith('/')) {
			fail('web manifest icons must use root-relative URLs');
		}
	}
}

export function assertServiceWorker(source) {
	if (typeof source !== 'string' || source.trim() === '') fail('service worker is empty');
	if (!source.includes('precacheAndRoute')) fail('service worker does not contain a precache manifest');

	if (/https?:\/\/[^"'\s)]*\.supabase\.co/i.test(source)) {
		fail('service worker mentions a Supabase origin');
	}
	if (/\/(?:rest|auth|storage|functions)\/v1(?:\/|["'`?])/i.test(source)) {
		fail('service worker mentions a private API surface');
	}
}

export function assertHttpRedirect(baseUrl, status, location) {
	if (![301, 302, 307, 308].includes(status)) {
		fail('cleartext HTTP origin did not redirect');
	}
	if (!location) fail('cleartext HTTP redirect is missing Location');

	const cleartextUrl = new URL(baseUrl);
	cleartextUrl.protocol = 'http:';
	const redirectUrl = new URL(location, cleartextUrl);
	if (redirectUrl.protocol !== 'https:') fail('cleartext HTTP redirect did not upgrade to HTTPS');
	if (redirectUrl.host !== baseUrl.host) fail('cleartext HTTP redirect did not preserve the same host');
}
