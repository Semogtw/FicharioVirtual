import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const helperPath = join(root, 'supabase/functions/_shared/desktop-worker-auth.ts');
const pairPath = join(root, 'supabase/functions/desktop-ocr-pair/index.ts');
const workerPath = join(root, 'supabase/functions/desktop-ocr-worker/index.ts');
const configPath = join(root, 'supabase/config.toml');
const authMigrationPath = join(
	root,
	'supabase/migrations/202608081027_desktop_ocr_device_auth_boundary.sql'
);

const [helper, pair, worker, config, authMigration] = await Promise.all(
	[helperPath, pairPath, workerPath, configPath, authMigrationPath].map((path) => readFile(path, 'utf8'))
);
const failures = [];

function requireSource(source, pattern, message) {
	if (!pattern.test(source)) failures.push(message);
}

function forbidSource(source, pattern, message) {
	if (pattern.test(source)) failures.push(message);
}

requireSource(helper, /RAW_CREDENTIAL_BYTES\s*=\s*32\b/, 'worker credential must contain 32 random bytes');
requireSource(
	helper,
	/RAW_CREDENTIAL_PATTERN\s*=\s*\/\^\[A-Za-z0-9_\-\]\{43\}\$\//,
	'worker credential must use canonical unpadded base64url length'
);
requireSource(helper, /crypto\.subtle\.digest\('SHA-256'/, 'worker credential must be stored by SHA-256 digest');
requireSource(helper, /bytes\.fill\(0\)/, 'generated raw credential bytes must be cleared after hashing');
requireSource(
	helper,
	/AUTHORIZATION_PREFIX\s*=\s*'FicharioWorker '/,
	'worker authorization must use a dedicated scheme rather than browser JWTs'
);

for (const [name, source] of [
	['pair', pair],
	['worker', worker]
]) {
	requireSource(source, /from '\.\.\/_shared\/cors\.ts'/, `${name} endpoint must use shared CORS policy`);
	requireSource(source, /parseAppOrigin/, `${name} endpoint must validate APP_ORIGIN`);
	requireSource(source, /'Cache-Control': 'no-store'/, `${name} endpoint must disable response caching`);
	requireSource(source, /'Referrer-Policy': 'no-referrer'/, `${name} endpoint must suppress referrers`);
	forbidSource(
		source,
		/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*/,
		`${name} endpoint must never allow wildcard CORS`
	);
	forbidSource(source, /console\.(?:log|info|warn|error)/, `${name} endpoint must not log credentials or job metadata`);
}

requireSource(pair, /generateDesktopWorkerCredential\(\)/, 'pairing must generate the credential server-side');
requireSource(pair, /register_ocr_worker_device/, 'pairing must persist only through the service registration RPC');
requireSource(pair, /credential:\s*generated\.credential/, 'pairing must return the raw credential exactly once');
forbidSource(pair, /digestHex\s*:/, 'pairing response must not expose the stored credential digest');

requireSource(
	worker,
	/parseDesktopWorkerAuthorization\(request\.headers\.get\('Authorization'\)\)/,
	'worker endpoint must authenticate the dedicated Authorization credential'
);
requireSource(worker, /authenticate_ocr_worker_device/, 'worker endpoint must authenticate the digest before job access');
requireSource(worker, /claim_desktop_ocr_job/, 'worker endpoint must use the service-only claim RPC');
requireSource(worker, /renew_desktop_ocr_job_lease/, 'worker endpoint must use the service-only renewal RPC');
requireSource(worker, /get_desktop_ocr_job_source/, 'worker endpoint must resolve source through the exact lease RPC');
requireSource(worker, /SOURCE_URL_SECONDS\s*=\s*60\b/, 'worker source URL must remain short-lived');
requireSource(worker, /sourceSha256/, 'worker source response must include an integrity digest');
requireSource(worker, /MAX_SOURCE_BYTES\s*=\s*12\s*\*\s*1024\s*\*\s*1024/, 'worker source download must preserve the 12 MiB derived-page ceiling');
forbidSource(worker, /GEMINI_API_KEY/, 'worker endpoint must never receive Gemini credentials');
forbidSource(worker, /GOOGLE_(?:CLIENT|DRIVE|OAUTH|REFRESH|ACCESS)/, 'worker endpoint must never receive Google credentials');

requireSource(
	config,
	/\[functions\.desktop-ocr-pair\][\s\S]*?verify_jwt\s*=\s*true/,
	'pairing endpoint must require a Supabase user JWT'
);
requireSource(
	config,
	/\[functions\.desktop-ocr-worker\][\s\S]*?verify_jwt\s*=\s*false/,
	'worker endpoint must bypass browser JWT verification for its dedicated credential'
);

requireSource(authMigration, /credential_hash\b/, 'database boundary must persist only a credential digest');
requireSource(
	authMigration,
	/revoke execute on function public\.authenticate_ocr_worker_device\(text\) from authenticated/,
	'browser role must not authenticate worker credential digests directly'
);
requireSource(
	authMigration,
	/grant execute on function public\.authenticate_ocr_worker_device\(text\) to service_role/,
	'worker digest authentication must remain service-role only'
);

if (failures.length > 0) {
	console.error(`Desktop worker boundary checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Desktop worker boundary checks passed.');
}
