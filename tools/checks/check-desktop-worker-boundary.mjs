import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const helperPath = join(root, 'supabase/functions/_shared/desktop-worker-auth.ts');
const contractPath = join(root, 'supabase/functions/_shared/desktop-worker-contract.ts');
const pairPath = join(root, 'supabase/functions/desktop-ocr-pair/index.ts');
const workerPath = join(root, 'supabase/functions/desktop-ocr-worker/index.ts');
const configPath = join(root, 'supabase/config.toml');
const authMigrationPath = join(
	root,
	'supabase/migrations/202608081027_desktop_ocr_device_auth_boundary.sql'
);
const sourceBindingMigrationPath = join(
	root,
	'supabase/migrations/202608081028_desktop_ocr_source_binding.sql'
);
const completionMigrationPath = join(
	root,
	'supabase/migrations/202608081029_desktop_ocr_completion.sql'
);

const [
	helper,
	contract,
	pair,
	worker,
	config,
	authMigration,
	sourceBindingMigration,
	completionMigration
] = await Promise.all(
	[
		helperPath,
		contractPath,
		pairPath,
		workerPath,
		configPath,
		authMigrationPath,
		sourceBindingMigrationPath,
		completionMigrationPath
	].map((path) => readFile(path, 'utf8'))
);
const failures = [];

function requireSource(source, pattern, message) {
	if (!pattern.test(source)) failures.push(message);
}

function forbidSource(source, pattern, message) {
	if (pattern.test(source)) failures.push(message);
}

requireSource(
	helper,
	/RAW_CREDENTIAL_BYTES\s*=\s*32\b/,
	'worker credential must contain 32 random bytes'
);
requireSource(
	helper,
	/RAW_CREDENTIAL_PATTERN\s*=\s*\/\^\[A-Za-z0-9_-\]\{43\}\$\//,
	'worker credential must use canonical unpadded base64url length'
);
requireSource(
	helper,
	/crypto\.subtle\.digest\('SHA-256'/,
	'worker credential must be stored by SHA-256 digest'
);
requireSource(
	helper,
	/bytes\.fill\(0\)/,
	'generated raw credential bytes must be cleared after hashing'
);
requireSource(
	helper,
	/AUTHORIZATION_PREFIX\s*=\s*'FicharioWorker '/,
	'worker authorization must use a dedicated scheme rather than browser JWTs'
);

requireSource(
	contract,
	/action:\s*'complete'/,
	'worker contract must define the completion action'
);
requireSource(
	contract,
	/sourceSha256:\s*string/,
	'completion contract must carry the exact source digest'
);
requireSource(
	contract,
	/backend:\s*'transformers'\s*\|\s*'ollama'/,
	'completion contract must allow only approved local backends'
);
requireSource(
	contract,
	/MAX_TEXT_LENGTH\s*=\s*1_000_000\b/,
	'completion text must retain its 1 MB ceiling'
);
requireSource(
	contract,
	/MAX_WARNINGS\s*=\s*100\b/,
	'completion warnings must retain their cardinality ceiling'
);
requireSource(contract, /hasExactKeys\(/, 'worker requests must reject widened payload shapes');

for (const [name, source] of [
	['pair', pair],
	['worker', worker]
]) {
	requireSource(
		source,
		/from '\.\.\/_shared\/cors\.ts'/,
		`${name} endpoint must use shared CORS policy`
	);
	requireSource(source, /parseAppOrigin/, `${name} endpoint must validate APP_ORIGIN`);
	requireSource(
		source,
		/'Cache-Control': 'no-store'/,
		`${name} endpoint must disable response caching`
	);
	requireSource(
		source,
		/'Referrer-Policy': 'no-referrer'/,
		`${name} endpoint must suppress referrers`
	);
	forbidSource(
		source,
		/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*/,
		`${name} endpoint must never allow wildcard CORS`
	);
	forbidSource(
		source,
		/console\.(?:log|info|warn|error)/,
		`${name} endpoint must not log credentials or job metadata`
	);
}

requireSource(
	pair,
	/generateDesktopWorkerCredential\(\)/,
	'pairing must generate the credential server-side'
);
requireSource(
	pair,
	/register_ocr_worker_device/,
	'pairing must persist only through the service registration RPC'
);
requireSource(
	pair,
	/credential:\s*generated\.credential/,
	'pairing must return the raw credential exactly once'
);
forbidSource(
	pair,
	/digestHex\s*:/,
	'pairing response must not expose the stored credential digest'
);

requireSource(
	worker,
	/parseDesktopWorkerAuthorization\(request\.headers\.get\('Authorization'\)\)/,
	'worker endpoint must authenticate the dedicated Authorization credential'
);
requireSource(
	worker,
	/parseDesktopWorkerRequest\(rawBody\)/,
	'worker endpoint must use the strict shared request contract'
);
requireSource(
	worker,
	/authenticate_ocr_worker_device/,
	'worker endpoint must authenticate the digest before job access'
);
requireSource(
	worker,
	/claim_desktop_ocr_job/,
	'worker endpoint must use the service-only claim RPC'
);
requireSource(
	worker,
	/renew_desktop_ocr_job_lease/,
	'worker endpoint must use the service-only renewal RPC'
);
requireSource(
	worker,
	/get_desktop_ocr_job_source/,
	'worker endpoint must resolve source through the exact lease RPC'
);
requireSource(
	worker,
	/bind_desktop_ocr_job_source_hash/,
	'worker endpoint must bind source integrity before delivery'
);
requireSource(
	worker,
	/complete_desktop_ocr_job/,
	'worker endpoint must complete through the lease-bound service RPC'
);
requireSource(
	worker,
	/clear_desktop_ocr_completed_source/,
	'worker endpoint must clear the source pointer only after storage cleanup'
);
requireSource(
	worker,
	/\.remove\(\[completion\.sourceStoragePath\]\)/,
	'worker completion must delete the private derivative before clearing its pointer'
);
requireSource(
	worker,
	/cleanupPending/,
	'worker completion must expose recoverable derivative cleanup state'
);
requireSource(worker, /SOURCE_URL_SECONDS\s*=\s*60\b/, 'worker source URL must remain short-lived');
requireSource(worker, /sourceSha256/, 'worker source response must include an integrity digest');
requireSource(
	worker,
	/MAX_SOURCE_BYTES\s*=\s*12\s*\*\s*1024\s*\*\s*1024/,
	'worker source download must preserve the 12 MiB derived-page ceiling'
);
forbidSource(worker, /GEMINI_API_KEY/, 'worker endpoint must never receive Gemini credentials');
forbidSource(
	worker,
	/GOOGLE_(?:CLIENT|DRIVE|OAUTH|REFRESH|ACCESS)/,
	'worker endpoint must never receive Google credentials'
);

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

requireSource(
	authMigration,
	/credential_hash\b/,
	'database boundary must persist only a credential digest'
);
requireSource(
	authMigration,
	/page\.temporary_image_path\s+as\s+storage_path/,
	'desktop source resolver must expose the private per-page derivative path'
);
forbidSource(
	authMigration,
	/page\.storage_path/,
	'desktop source resolver must not reference the nonexistent page.storage_path column'
);
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

requireSource(
	sourceBindingMigration,
	/desktop_source_sha256\s+text/,
	'active desktop leases must persist the delivered source digest'
);
requireSource(
	sourceBindingMigration,
	/bind_desktop_ocr_job_source_hash/,
	'source digest binding RPC must remain present'
);
requireSource(
	sourceBindingMigration,
	/revoke execute on function public\.bind_desktop_ocr_job_source_hash\(uuid, uuid, uuid, text\) from authenticated/,
	'browser role must not bind desktop source digests'
);
requireSource(
	sourceBindingMigration,
	/grant execute on function public\.bind_desktop_ocr_job_source_hash\(uuid, uuid, uuid, text\) to service_role/,
	'source digest binding must remain service-role only'
);

requireSource(
	completionMigration,
	/provider,\s*model,\s*raw_text,/s,
	'desktop completion must persist immutable OCR result provenance'
);
requireSource(
	completionMigration,
	/'local',\s*target_model,/s,
	'desktop completion result provider must be local'
);
requireSource(
	completionMigration,
	/current_job\.desktop_source_sha256\s+is distinct from\s+target_source_sha256/,
	'desktop completion must require the bound source digest'
);
requireSource(
	completionMigration,
	/current_job\.desktop_lease_id\s+is distinct from\s+target_lease_id/,
	'desktop completion must require the exact lease id'
);
requireSource(
	completionMigration,
	/current_job\.desktop_lease_device_id\s+is distinct from\s+target_device_id/,
	'desktop completion must require the exact device id'
);
requireSource(
	completionMigration,
	/'source',\s*'desktop_worker'/,
	'local OCR result metadata must identify the desktop worker source'
);
requireSource(
	completionMigration,
	/'desktopLeaseId',\s*target_lease_id/,
	'local OCR result metadata must preserve lease provenance for retries'
);
requireSource(
	completionMigration,
	/'sourceSha256',\s*target_source_sha256/,
	'local OCR result metadata must preserve source integrity provenance'
);
requireSource(
	completionMigration,
	/clear_desktop_ocr_completed_source/,
	'completion migration must provide constrained derivative cleanup'
);
requireSource(
	completionMigration,
	/revoke execute on function public\.complete_desktop_ocr_job\([\s\S]*?\) from authenticated/,
	'browser role must not complete desktop OCR jobs directly'
);
requireSource(
	completionMigration,
	/grant execute on function public\.complete_desktop_ocr_job\([\s\S]*?\) to service_role/,
	'desktop completion must remain service-role only'
);
requireSource(
	completionMigration,
	/revoke execute on function public\.clear_desktop_ocr_completed_source\(uuid, uuid, text\) from authenticated/,
	'browser role must not clear completed desktop source pointers'
);

if (failures.length > 0) {
	console.error(`Desktop worker boundary checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Desktop worker boundary checks passed.');
}
