import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { assertSecurityHeaders } from './deployment-contract.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const build = join(root, 'build');
const failures = [];

function fail(detail) {
	failures.push(detail);
}

async function requiredFile(name) {
	try {
		return await readFile(join(build, name), 'utf8');
	} catch {
		fail(`${name} is missing from the static build`);
		return '';
	}
}

function parseRootStaticHeaders(source) {
	const lines = source.split(/\r?\n/);
	const rootIndex = lines.findIndex((line) => line.trim() === '/*');
	if (rootIndex < 0) throw new Error('_headers is missing the /* root rule');

	const headers = new Headers();
	const names = new Set();
	for (const line of lines.slice(rootIndex + 1)) {
		if (line.trim() === '') break;
		if (!/^\s+/.test(line)) break;
		const separator = line.indexOf(':');
		if (separator <= 0) throw new Error('_headers contains an invalid root header line');
		const name = line.slice(0, separator).trim().toLowerCase();
		const value = line.slice(separator + 1).trim();
		if (!name || !value) throw new Error('_headers contains an empty root header');
		if (names.has(name)) throw new Error(`_headers repeats root header ${name}`);
		names.add(name);
		headers.set(name, value);
	}
	if (names.size === 0) throw new Error('_headers root rule has no headers');
	return headers;
}

const [manifestSource, serviceWorker, registerScript, fallback, staticHeaders] = await Promise.all([
	requiredFile('manifest.webmanifest'),
	requiredFile('sw.js'),
	requiredFile('registerSW.js'),
	requiredFile('200.html'),
	requiredFile('_headers')
]);

if (manifestSource) {
	try {
		const manifest = JSON.parse(manifestSource);
		if (manifest.name !== 'Fichário Virtual') fail('manifest name is incorrect');
		if (manifest.short_name !== 'Fichário') fail('manifest short_name is incorrect');
		if (manifest.display !== 'standalone') fail('manifest must use standalone display mode');
		if (manifest.start_url !== '/' || manifest.scope !== '/') {
			fail('manifest start_url and scope must remain at the application root');
		}
		if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
			fail('manifest must expose at least one application icon');
		}
	} catch (error) {
		fail(
			`manifest.webmanifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

if (fallback) {
	if (!/rel=["']manifest["'][^>]+href=["'][^"']*manifest\.webmanifest["']/.test(fallback)) {
		fail('200.html must link the generated web app manifest');
	}
	if (!/<script[^>]+src=["'][^"']*registerSW\.js["'][^>]*\bdefer\b/i.test(fallback)) {
		fail('200.html must register the service worker through an external deferred script');
	}
}

if (registerScript && !/serviceWorker/.test(registerScript)) {
	fail('registerSW.js does not register a service worker');
}

if (serviceWorker) {
	for (const forbidden of ['supabase.co', '/rest/v1', '/storage/v1', '/functions/v1', '/auth/v1']) {
		if (serviceWorker.includes(forbidden)) fail(`sw.js must not contain ${forbidden}`);
	}
	if (
		/(?:library|notebooks|search|review|settings|import|login)\/index\.html/.test(serviceWorker)
	) {
		fail('sw.js must not precache route-specific HTML; only the public fallback shell is allowed');
	}
	if (!serviceWorker.includes('200.html')) {
		fail('sw.js must precache the static adapter fallback shell');
	}
}

if (staticHeaders) {
	try {
		assertSecurityHeaders(parseRootStaticHeaders(staticHeaders));
	} catch (error) {
		fail(
			`_headers root security contract is invalid: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

if (failures.length > 0) {
	console.error(`Built PWA checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Built PWA checks passed.');
}
