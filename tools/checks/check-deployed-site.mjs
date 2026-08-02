#!/usr/bin/env node

import {
	assertAppShell,
	assertHttpRedirect,
	assertManifest,
	assertSecurityHeaders,
	assertServiceWorker,
	parseDeploymentUrl
} from './deployment-contract.mjs';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * @typedef {{ redirect?: RequestRedirect; accept?: string }} RequestOptions
 */

/**
 * @param {URL} baseUrl
 * @param {string} pathname
 * @returns {URL}
 */
function urlAt(baseUrl, pathname) {
	return new URL(pathname, baseUrl);
}

/**
 * @param {URL} url
 * @param {RequestOptions} [options]
 * @returns {Promise<Response>}
 */
async function request(url, { redirect = 'follow', accept = '*/*' } = {}) {
	try {
		return await fetch(url, {
			redirect,
			headers: { accept },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (error) {
		throw new Error(`Request failed for ${url}: ${error instanceof Error ? error.message : error}`);
	}
}

/**
 * @param {Response} response
 * @param {string} label
 */
function assertOk(response, label) {
	if (!response.ok) {
		throw new Error(`${label} returned HTTP ${response.status}`);
	}
}

/**
 * @param {Response} response
 * @param {string} expected
 * @param {string} label
 */
function assertContentType(response, expected, label) {
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().includes(expected)) {
		throw new Error(`${label} returned unexpected Content-Type: ${contentType || '(missing)'}`);
	}
}

/**
 * @param {Response} response
 * @param {string} label
 */
function assertNoLongLivedCache(response, label) {
	const cacheControl = response.headers.get('cache-control') ?? '';
	if (
		/\b(?:public|immutable)\b/i.test(cacheControl) ||
		/max-age=(?:[1-9]\d{2,}|[2-9]\d)/i.test(cacheControl)
	) {
		throw new Error(`${label} is configured with a long-lived cache: ${cacheControl}`);
	}
}

/**
 * @param {URL} baseUrl
 */
async function verifyHttpRedirect(baseUrl) {
	const cleartextUrl = new URL(baseUrl);
	cleartextUrl.protocol = 'http:';
	const response = await request(cleartextUrl, { redirect: 'manual' });
	assertHttpRedirect(baseUrl, response.status, response.headers.get('location'));
	console.log('PASS HTTP redirects to the same HTTPS host');
}

/**
 * @param {URL} baseUrl
 * @param {string} pathname
 * @param {string} label
 */
async function verifyShell(baseUrl, pathname, label) {
	const response = await request(urlAt(baseUrl, pathname), { accept: 'text/html' });
	assertOk(response, label);
	assertContentType(response, 'text/html', label);
	assertSecurityHeaders(response.headers);
	assertNoLongLivedCache(response, label);
	assertAppShell(await response.text());
	console.log(`PASS ${label}`);
}

/**
 * @param {URL} baseUrl
 */
async function verifyManifest(baseUrl) {
	const response = await request(urlAt(baseUrl, '/manifest.webmanifest'), {
		accept: 'application/manifest+json, application/json'
	});
	assertOk(response, 'Web manifest');
	assertContentType(response, 'json', 'Web manifest');
	const manifest = await response.json();
	assertManifest(manifest);

	const manifestValue = /** @type {Record<string, unknown>} */ (manifest);
	const icons = manifestValue.icons;
	if (!Array.isArray(icons) || icons.length === 0) {
		throw new Error('Web manifest does not expose an icon after validation');
	}
	const icon = /** @type {Record<string, unknown>} */ (icons[0]);
	if (typeof icon.src !== 'string') {
		throw new Error('Web manifest icon source is unavailable after validation');
	}

	const iconResponse = await request(urlAt(baseUrl, icon.src), { accept: 'image/*' });
	assertOk(iconResponse, 'Manifest icon');
	assertContentType(iconResponse, 'image/', 'Manifest icon');
	console.log('PASS web manifest and icon');
}

/**
 * @param {URL} baseUrl
 */
async function verifyRegistrar(baseUrl) {
	const response = await request(urlAt(baseUrl, '/registerSW.js'), {
		accept: 'text/javascript, application/javascript'
	});
	assertOk(response, 'Service-worker registrar');
	assertContentType(response, 'javascript', 'Service-worker registrar');
	assertNoLongLivedCache(response, 'Service-worker registrar');
	const source = await response.text();
	if (!source.includes('navigator.serviceWorker') || !source.includes("'/sw.js'")) {
		throw new Error('Service-worker registrar does not register /sw.js');
	}
	console.log('PASS external service-worker registrar');
}

/**
 * @param {URL} baseUrl
 */
async function verifyServiceWorker(baseUrl) {
	const response = await request(urlAt(baseUrl, '/sw.js'), {
		accept: 'text/javascript, application/javascript'
	});
	assertOk(response, 'Service worker');
	assertContentType(response, 'javascript', 'Service worker');
	assertNoLongLivedCache(response, 'Service worker');
	assertServiceWorker(await response.text());
	console.log('PASS service worker cache policy');
}

async function main() {
	const baseUrl = parseDeploymentUrl(process.argv[2] ?? process.env.STAGING_URL ?? '');
	console.log(`Checking deployed Fichário at ${baseUrl.origin}`);

	await verifyHttpRedirect(baseUrl);
	await verifyShell(baseUrl, '/', 'root app shell');
	await verifyShell(baseUrl, '/documents/deployment-contract-probe', 'SPA fallback');
	await verifyManifest(baseUrl);
	await verifyRegistrar(baseUrl);
	await verifyServiceWorker(baseUrl);

	console.log('Deployed site contract: PASS');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
