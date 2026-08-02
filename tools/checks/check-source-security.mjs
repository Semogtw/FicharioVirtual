import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const sourceRoots = ['src', 'static'];
const textExtensions = new Set(['.ts', '.js', '.mjs', '.svelte', '.html', '.css', '.json', '.svg']);
const failures = [];

async function files(directory) {
	const output = [];
	for (const name of await readdir(directory)) {
		const path = join(directory, name);
		const info = await stat(path);
		if (info.isDirectory()) output.push(...(await files(path)));
		else if (textExtensions.has(extname(path))) output.push(path);
	}
	return output;
}

function fail(path, rule, detail) {
	failures.push(`${relative(root, path)}: ${rule}: ${detail}`);
}

for (const sourceRoot of sourceRoots) {
	const directory = join(root, sourceRoot);
	for (const path of await files(directory)) {
		const content = await readFile(path, 'utf8');
		for (const pattern of [
			/GEMINI_API_KEY\s*=/g,
			/SUPABASE_SERVICE_ROLE/g,
			/service_role\s*[:=]/gi,
			/AIza[0-9A-Za-z_-]{20,}/g
		]) {
			if (pattern.test(content)) fail(path, 'secret-boundary', `matched ${pattern}`);
		}
		if (/generativelanguage\.googleapis\.com/i.test(content)) {
			fail(path, 'provider-boundary', 'Gemini endpoint must exist only under supabase/functions');
		}
		if (/createSignedUrl\([^,]+,\s*(?:[1-9]\d{3,}|[1-9]\d*\s*\*\s*60\s*\*\s*60)/.test(content)) {
			fail(path, 'signed-url-lifetime', 'signed URL appears longer than the short-lived contract');
		}
	}
}

const processOcrPath = join(root, 'supabase/functions/process-ocr/index.ts');
const deleteDocumentPath = join(root, 'supabase/functions/delete-document/index.ts');
const geminiClientPath = join(root, 'supabase/functions/_shared/gemini-ocr-client.ts');
const edgeFunctions = [processOcrPath, deleteDocumentPath];

for (const path of edgeFunctions) {
	const content = await readFile(path, 'utf8');
	if (!content.includes("from '../_shared/cors.ts'")) {
		fail(path, 'edge-cors', 'Edge Function must import the shared fail-closed CORS policy');
	}
	if (!content.includes('parseAppOrigin') || !content.includes('corsHeaders')) {
		fail(path, 'edge-cors', 'Edge Function must parse APP_ORIGIN and use shared CORS headers');
	}
	if (/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*/.test(content)) {
		fail(path, 'edge-cors', 'wildcard Access-Control-Allow-Origin is forbidden');
	}
}

const processOcr = await readFile(processOcrPath, 'utf8');
if (/generativelanguage\.googleapis\.com/i.test(processOcr)) {
	fail(processOcrPath, 'provider-duplication', 'provider endpoint belongs only in the shared Gemini client');
}
if (!processOcr.includes('requestGeminiOcr')) {
	fail(processOcrPath, 'provider-duplication', 'process-ocr must delegate provider transport and parsing');
}

const geminiClient = await readFile(geminiClientPath, 'utf8');
if (!/generativelanguage\.googleapis\.com/i.test(geminiClient)) {
	fail(geminiClientPath, 'provider-boundary', 'shared Gemini client must own the provider endpoint');
}

const pwaConfig = await readFile(join(root, 'vite.config.ts'), 'utf8');
if (/supabase\.co[^\n]*(?:CacheFirst|NetworkFirst|StaleWhileRevalidate)/i.test(pwaConfig)) {
	fail(join(root, 'vite.config.ts'), 'private-cache', 'Supabase requests must not be runtime cached');
}
if (!/injectRegister:\s*['"]script-defer['"]/.test(pwaConfig)) {
	fail(join(root, 'vite.config.ts'), 'csp', 'PWA registration must use an external deferred script');
}

const headers = await readFile(join(root, 'static/_headers'), 'utf8');
for (const required of [
	"frame-ancestors 'none'",
	'X-Content-Type-Options: nosniff',
	"script-src 'self' 'wasm-unsafe-eval'",
	"connect-src 'self' https://*.supabase.co wss://*.supabase.co"
]) {
	if (!headers.includes(required)) fail(join(root, 'static/_headers'), 'headers', `missing ${required}`);
}

if (failures.length > 0) {
	console.error(`Source security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Source security checks passed.');
}
