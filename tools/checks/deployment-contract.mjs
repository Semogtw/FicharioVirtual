import { createHash } from 'node:crypto';

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
	throw new Error(`Deployment contract failed: ${message}`);
}

/**
 * @param {Headers} headers
 * @param {string} name
 * @returns {string}
 */
function requireHeader(headers, name) {
	const value = headers.get(name);
	if (!value) fail(`missing ${name} header`);
	return value;
}

/**
 * @param {string} source
 * @returns {Map<string, Set<string>>}
 */
function parseCspDirectives(source) {
	const directives = new Map();
	for (const segment of source.split(';')) {
		const tokens = segment.trim().split(/\s+/).filter(Boolean);
		const name = tokens.shift()?.toLowerCase();
		if (!name) continue;
		if (directives.has(name)) fail(`Content-Security-Policy repeats ${name}`);
		directives.set(name, new Set(tokens));
	}
	return directives;
}

/**
 * @param {Map<string, Set<string>>} directives
 * @param {string} name
 * @param {string[]} requiredValues
 */
function requireCspDirective(directives, name, requiredValues) {
	const values = directives.get(name);
	if (!values) fail(`Content-Security-Policy must include ${name}`);
	for (const value of requiredValues) {
		if (!values.has(value)) fail(`Content-Security-Policy ${name} must include ${value}`);
	}
	return values;
}

/**
 * @param {string} html
 * @returns {string[]}
 */
function inlineScriptSources(html) {
	const sources = [];
	const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
	for (const match of html.matchAll(pattern)) {
		const attributes = match[1] ?? '';
		const source = match[2] ?? '';
		if (/\bsrc\s*=/i.test(attributes) || source.trim() === '') continue;
		sources.push(source);
	}
	return sources;
}

/**
 * @param {string} source
 * @returns {string}
 */
function cspScriptHash(source) {
	const digest = createHash('sha256').update(source, 'utf8').digest('base64');
	return `'sha256-${digest}'`;
}

/**
 * @param {unknown} value
 * @returns {URL}
 */
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

/**
 * @param {Headers} headers
 */
export function assertSecurityHeaders(headers) {
	const csp = parseCspDirectives(requireHeader(headers, 'content-security-policy'));
	requireCspDirective(csp, 'default-src', ["'self'"]);
	requireCspDirective(csp, 'base-uri', ["'self'"]);
	requireCspDirective(csp, 'form-action', ["'self'"]);
	requireCspDirective(csp, 'object-src', ["'none'"]);
	requireCspDirective(csp, 'frame-ancestors', ["'none'"]);
	const scripts = requireCspDirective(csp, 'script-src', [
		"'self'",
		"'wasm-unsafe-eval'",
		'https://apis.google.com'
	]);
	for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'"]) {
		if (scripts.has(forbidden))
			fail(`Content-Security-Policy script-src must not include ${forbidden}`);
	}
	requireCspDirective(csp, 'connect-src', [
		"'self'",
		'https://*.supabase.co',
		'wss://*.supabase.co',
		'https://www.googleapis.com'
	]);

	const hsts = requireHeader(headers, 'strict-transport-security');
	const maxAge = hsts.match(/(?:^|;)\s*max-age=(\d+)\s*(?:;|$)/i)?.[1];
	if (!maxAge) fail('Strict-Transport-Security must define max-age');
	if (Number(maxAge) < 31_536_000) {
		fail('Strict-Transport-Security max-age must be at least 31536000 seconds');
	}
	if (!/(?:^|;)\s*includeSubDomains\s*(?:;|$)/i.test(hsts)) {
		fail('Strict-Transport-Security must include includeSubDomains');
	}

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

/**
 * @param {Headers} headers
 * @param {unknown} html
 */
export function assertInlineScriptsAllowedByCsp(headers, html) {
	if (typeof html !== 'string' || html.trim() === '') fail('app shell HTML is empty');
	const csp = parseCspDirectives(requireHeader(headers, 'content-security-policy'));
	const scripts = requireCspDirective(csp, 'script-src', []);
	for (const source of inlineScriptSources(html)) {
		const hash = cspScriptHash(source);
		if (!scripts.has(hash)) {
			fail(`Content-Security-Policy script-src does not authorize inline bootstrap ${hash}`);
		}
	}
}

/**
 * @param {unknown} html
 */
export function assertAppShell(html) {
	if (typeof html !== 'string' || html.trim() === '') fail('app shell HTML is empty');
	if (!/<link[^>]+rel=["']manifest["'][^>]+href=["']\/manifest\.webmanifest["']/i.test(html)) {
		fail('app shell does not reference the web manifest');
	}
	if (!/<script[^>]+src=["']\/registerSW\.js["'][^>]*\bdefer\b[^>]*><\/script>/i.test(html)) {
		fail('app shell does not load the deferred external service-worker registrar');
	}
}

/**
 * @param {unknown} manifest
 */
export function assertManifest(manifest) {
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		fail('web manifest is not a JSON object');
	}

	const value = /** @type {Record<string, unknown>} */ (manifest);
	if (value.name !== 'Fichário Virtual') fail('web manifest name is unexpected');
	if (value.start_url !== '/') fail('web manifest start_url must be /');
	if (value.display !== 'standalone') fail('web manifest display must be standalone');
	if (!Array.isArray(value.icons) || value.icons.length === 0) {
		fail('web manifest must provide at least one icon');
	}
	for (const icon of value.icons) {
		if (!icon || typeof icon !== 'object' || Array.isArray(icon)) {
			fail('web manifest icons must be objects');
		}
		const iconValue = /** @type {Record<string, unknown>} */ (icon);
		if (typeof iconValue.src !== 'string' || !iconValue.src.startsWith('/')) {
			fail('web manifest icons must use root-relative URLs');
		}
	}
}

/**
 * @param {unknown} source
 */
export function assertServiceWorker(source) {
	if (typeof source !== 'string' || source.trim() === '') fail('service worker is empty');
	if (/https?:\/\/[^"'\s)]*\.supabase\.co/i.test(source)) {
		fail('service worker mentions a Supabase origin');
	}
	if (/\/(?:rest|auth|storage|functions)\/v1(?:\/|["'`?])/i.test(source)) {
		fail('service worker mentions a private API surface');
	}
	if (!source.includes('precacheAndRoute')) {
		fail('service worker does not contain a precache manifest');
	}
}

/**
 * @param {URL} baseUrl
 * @param {number} status
 * @param {string | null} location
 */
export function assertHttpRedirect(baseUrl, status, location) {
	if (![301, 302, 307, 308].includes(status)) {
		fail('cleartext HTTP origin did not redirect');
	}
	if (!location) fail('cleartext HTTP redirect is missing Location');

	const cleartextUrl = new URL(baseUrl);
	cleartextUrl.protocol = 'http:';
	const redirectUrl = new URL(location, cleartextUrl);
	if (redirectUrl.protocol !== 'https:') fail('cleartext HTTP redirect did not upgrade to HTTPS');
	if (redirectUrl.host !== baseUrl.host) {
		fail('cleartext HTTP redirect did not preserve the same host');
	}
}
