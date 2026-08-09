import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const failures = [];
const [helper, processOcr, pair, worker, deleteDocument, resolveFolder] = await Promise.all([
	readFile(join(root, 'supabase/functions/_shared/bounded-json.ts'), 'utf8'),
	readFile(join(root, 'supabase/functions/process-ocr/index.ts'), 'utf8'),
	readFile(join(root, 'supabase/functions/desktop-ocr-pair/index.ts'), 'utf8'),
	readFile(join(root, 'supabase/functions/desktop-ocr-worker/index.ts'), 'utf8'),
	readFile(join(root, 'supabase/functions/delete-document/index.ts'), 'utf8'),
	readFile(join(root, 'supabase/functions/drive-resolve-folder/index.ts'), 'utf8')
]);

for (const required of [
	'request.body.getReader()',
	'total > maxBytes',
	"new TextDecoder('utf-8', { fatal: true })",
	'bytes.fill(0)'
]) {
	if (!helper.includes(required)) failures.push(`bounded JSON reader missing ${required}`);
}

for (const [name, source, expectedLimit] of [
	['process-ocr', processOcr, '16 * 1024'],
	['desktop-ocr-pair', pair, '16 * 1024'],
	['desktop-ocr-worker', worker, '8 * 1024 * 1024'],
	['delete-document', deleteDocument, '1024'],
	['drive-resolve-folder', resolveFolder, '1024']
]) {
	if (!source.includes("from '../_shared/bounded-json.ts'")) {
		failures.push(`${name}: endpoint must use the shared bounded JSON reader`);
	}
	if (!source.includes(`MAX_REQUEST_BODY_BYTES = ${expectedLimit}`)) {
		failures.push(`${name}: request-body limit changed without security review`);
	}
	if (!source.includes('readBoundedJson(request, MAX_REQUEST_BODY_BYTES)')) {
		failures.push(`${name}: endpoint must enforce its request-body ceiling before parsing`);
	}
	if (!source.includes('RequestBodyTooLargeError')) {
		failures.push(`${name}: endpoint must distinguish oversized requests with HTTP 413`);
	}
	if (/\brequest\.json\s*\(/.test(source)) {
		failures.push(`${name}: unbounded request.json() is forbidden`);
	}
}

if (failures.length > 0) {
	console.error(`Edge request body security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Edge request body security checks passed.');
}
