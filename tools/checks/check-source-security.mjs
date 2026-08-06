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
			/GEMINI_API_KEY\s*=/,
			/SUPABASE_SERVICE_ROLE/,
			/service_role\s*[:=]/i,
			/AIza[0-9A-Za-z_-]{20,}/
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
const driveOauthStartPath = join(root, 'supabase/functions/drive-oauth-start/index.ts');
const driveAccessTokenPath = join(root, 'supabase/functions/drive-access-token/index.ts');
const driveResolveFolderPath = join(root, 'supabase/functions/drive-resolve-folder/index.ts');
const driveRunJobsPath = join(root, 'supabase/functions/drive-run-jobs/index.ts');
const driveSyncPath = join(root, 'supabase/functions/drive-sync/index.ts');
const driveOauthCallbackPath = join(root, 'supabase/functions/drive-oauth-callback/index.ts');
const geminiClientPath = join(root, 'supabase/functions/_shared/gemini-ocr-client.ts');
const corsEdgeFunctions = [
	processOcrPath,
	deleteDocumentPath,
	driveOauthStartPath,
	driveAccessTokenPath,
	driveResolveFolderPath,
	driveRunJobsPath,
	driveSyncPath
];

for (const path of corsEdgeFunctions) {
	const content = await readFile(path, 'utf8');
	if (!content.includes("from '../_shared/cors.ts'")) {
		fail(path, 'edge-cors', 'Edge Function must import the shared fail-closed CORS policy');
	}
	if (!content.includes('parseAppOrigin') || !content.includes('corsHeaders')) {
		fail(path, 'edge-cors', 'Edge Function must parse APP_ORIGIN and use shared CORS headers');
	}
	if (!content.includes("request.method === 'OPTIONS'")) {
		fail(path, 'edge-cors', 'browser-facing Edge Function must answer CORS preflight');
	}
	if (!content.includes("'Cache-Control': 'no-store'")) {
		fail(path, 'edge-cache', 'authenticated Edge Function responses must disable caching');
	}
	if (/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*/.test(content)) {
		fail(path, 'edge-cors', 'wildcard Access-Control-Allow-Origin is forbidden');
	}
}

const driveOauthCallback = await readFile(driveOauthCallbackPath, 'utf8');
if (!driveOauthCallback.includes("from '../_shared/cors.ts'")) {
	fail(
		driveOauthCallbackPath,
		'oauth-callback-origin',
		'callback must import the shared origin parser'
	);
}
if (!driveOauthCallback.includes('parseAppOrigin')) {
	fail(driveOauthCallbackPath, 'oauth-callback-origin', 'callback must validate APP_ORIGIN');
}
if (!driveOauthCallback.includes('status: 303') || !driveOauthCallback.includes('Location:')) {
	fail(driveOauthCallbackPath, 'oauth-callback-redirect', 'callback must use an explicit safe redirect');
}
if (!driveOauthCallback.includes("'Cache-Control': 'no-store'")) {
	fail(driveOauthCallbackPath, 'oauth-callback-cache', 'callback redirects must disable caching');
}
if (!driveOauthCallback.includes("'Referrer-Policy': 'no-referrer'")) {
	fail(driveOauthCallbackPath, 'oauth-callback-referrer', 'callback redirects must suppress referrers');
}
if (/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*/.test(driveOauthCallback)) {
	fail(driveOauthCallbackPath, 'oauth-callback-origin', 'wildcard callback origin is forbidden');
}

const processOcr = await readFile(processOcrPath, 'utf8');
if (/generativelanguage\.googleapis\.com/i.test(processOcr)) {
	fail(
		processOcrPath,
		'provider-duplication',
		'provider endpoint belongs only in the shared Gemini client'
	);
}
if (!processOcr.includes('requestGeminiOcr')) {
	fail(
		processOcrPath,
		'provider-duplication',
		'process-ocr must delegate provider transport and parsing'
	);
}
if (/\bfetchImpl\s*:/.test(processOcr)) {
	fail(
		processOcrPath,
		'provider-transport-injection',
		'process-ocr must not inject an alternate provider transport'
	);
}

const geminiClient = await readFile(geminiClientPath, 'utf8');
if (!/generativelanguage\.googleapis\.com/i.test(geminiClient)) {
	fail(
		geminiClientPath,
		'provider-boundary',
		'shared Gemini client must own the provider endpoint'
	);
}

const forbiddenProviderTestSurfaces = [
	['GEMINI_API_URL', /\bGEMINI_(?:API_)?(?:URL|ENDPOINT)\b/i],
	['OCR_PROVIDER_URL', /\bOCR_(?:PROVIDER_)?(?:URL|ENDPOINT)\b/i],
	['X-FICHARIO-FAULT', /\bX-FICHARIO-(?:FAULT|TEST)\b/i]
];
for (const path of [processOcrPath, geminiClientPath]) {
	const content = path === processOcrPath ? processOcr : geminiClient;
	for (const [name, pattern] of forbiddenProviderTestSurfaces) {
		if (pattern.test(content)) {
			fail(
				path,
				'provider-test-surface',
				`deployed provider code must not expose ${name} overrides or fault controls`
			);
		}
	}
}

const viteConfigPath = join(root, 'vite.config.ts');
const appHtmlPath = join(root, 'src/app.html');
const pwaConfig = await readFile(viteConfigPath, 'utf8');
const appHtml = await readFile(appHtmlPath, 'utf8');
if (/supabase\.co[^\n]*(?:CacheFirst|NetworkFirst|StaleWhileRevalidate)/i.test(pwaConfig)) {
	fail(viteConfigPath, 'private-cache', 'Supabase requests must not be runtime cached');
}
if (!/injectRegister:\s*false/.test(pwaConfig)) {
	fail(viteConfigPath, 'csp', 'automatic PWA registration must stay disabled');
}
if (
	!/<link\s+rel=["']manifest["']\s+href=["']%sveltekit\.assets%\/manifest\.webmanifest["']\s*\/>/.test(
		appHtml
	)
) {
	fail(appHtmlPath, 'pwa-manifest', 'the application template must link the generated manifest');
}
if (!/<script\s+src=["']%sveltekit\.assets%\/registerSW\.js["']\s+defer><\/script>/.test(appHtml)) {
	fail(appHtmlPath, 'csp', 'PWA registration must use an external deferred script');
}

const headers = await readFile(join(root, 'static/_headers'), 'utf8');
for (const required of [
	"frame-ancestors 'none'",
	'X-Content-Type-Options: nosniff',
	"script-src 'self' 'wasm-unsafe-eval'",
	"connect-src 'self' https://*.supabase.co wss://*.supabase.co"
]) {
	if (!headers.includes(required)) {
		fail(join(root, 'static/_headers'), 'headers', `missing ${required}`);
	}
}

if (failures.length > 0) {
	console.error(`Source security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Source security checks passed.');
}
