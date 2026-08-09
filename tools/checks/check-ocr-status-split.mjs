import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const splitPath = join(root, 'supabase/migrations/202608081019_split_page_and_ocr_status.sql');
const historyPath = join(root, 'supabase/migrations/202608081020_ocr_result_history.sql');
const desktopStatusPath = join(root, 'supabase/migrations/202608081022_desktop_ocr_status_enum.sql');
const routePath = join(root, 'supabase/migrations/202608081024_desktop_ocr_job_leases.sql');
const authPath = join(root, 'supabase/migrations/202608081027_desktop_ocr_device_auth_boundary.sql');

const [split, history, desktopStatus, route, auth] = await Promise.all(
	[splitPath, historyPath, desktopStatusPath, routePath, authPath].map((path) => readFile(path, 'utf8'))
);
const failures = [];

function requireSource(source, pattern, message) {
	if (!pattern.test(source)) failures.push(message);
}

function forbidSource(source, pattern, message) {
	if (pattern.test(source)) failures.push(message);
}

requireSource(split, /create type public\.page_status as enum/, 'migration 1019 must create page_status before result history');
requireSource(split, /create type public\.ocr_status as enum/, 'migration 1019 must create ocr_status before desktop job states');
requireSource(
	split,
	/alter table public\.pages[\s\S]*?alter column status type public\.page_status/,
	'pages.status must be converted to page_status'
);
requireSource(
	split,
	/alter table public\.ocr_jobs[\s\S]*?alter column status type public\.ocr_status/,
	'ocr_jobs.status must be converted to ocr_status'
);
requireSource(
	split,
	/create cast \(public\.processing_status as public\.page_status\)/,
	'legacy processing_status assignments must remain compatible with page_status'
);
requireSource(
	split,
	/create cast \(public\.processing_status as public\.ocr_status\)/,
	'legacy processing_status assignments must remain compatible with ocr_status'
);
forbidSource(
	split,
	/create cast \(public\.(?:page_status|ocr_status) as public\.processing_status\)/,
	'worker-only OCR states must never cast back into the legacy shared status domain'
);
requireSource(
	split,
	/function public\.complete_ocr_job\([\s\S]*?terminal_status public\.page_status/,
	'completion summary RPC must be rebuilt with page_status before result history wraps it'
);

requireSource(
	history,
	/alter function public\.complete_ocr_job\(uuid, text, jsonb, public\.page_status, timestamptz\)/,
	'result history must wrap the typed page completion RPC'
);
requireSource(history, /current_job\.batch_id\b/, 'result history metadata must reference the real OCR batch column');
forbidSource(history, /current_job\.ocr_batch_id\b/, 'result history must not reference the nonexistent ocr_batch_id column');

requireSource(
	desktopStatus,
	/alter type public\.ocr_status add value if not exists 'waiting_desktop'/,
	'desktop-only waiting state must extend ocr_status only'
);
forbidSource(desktopStatus, /page_status[\s\S]*waiting_desktop/, 'waiting_desktop must never become a page status');

requireSource(
	route,
	/current_job\.status = 'pending'::public\.ocr_status[\s\S]*?next_status := 'waiting_desktop'::public\.ocr_status/,
	'pending Gemini work must be routable to the desktop waiting queue'
);
requireSource(
	route,
	/current_job\.status = 'waiting_desktop'::public\.ocr_status[\s\S]*?next_status := 'pending'::public\.ocr_status/,
	'desktop waiting work must be routable back to the Gemini pending queue'
);
forbidSource(route, /'queued'::public\.ocr_status/, 'desktop routing must not depend on the nonexistent queued OCR state');

requireSource(
	auth,
	/page\.temporary_image_path\s+as\s+storage_path/,
	'desktop source resolver must use pages.temporary_image_path'
);
forbidSource(auth, /page\.storage_path/, 'desktop source resolver must not use nonexistent pages.storage_path');

if (failures.length > 0) {
	console.error(`OCR status split checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('OCR status split checks passed.');
}
