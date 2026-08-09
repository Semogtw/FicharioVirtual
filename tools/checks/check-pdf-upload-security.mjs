import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const failures = [];
const [limits, worker, resumeStore, config] = await Promise.all([
	readFile(join(root, 'src/lib/pdf/limits.ts'), 'utf8'),
	readFile(join(root, 'src/lib/pdf/inspector-worker.ts'), 'utf8'),
	readFile(join(root, 'src/lib/pdf/resume-store.ts'), 'utf8'),
	readFile(join(root, 'supabase/config.toml'), 'utf8')
]);

if (!/MAX_LOCAL_PDF_BYTES\s*=\s*20\s*\*\s*1024\s*\*\s*1024/.test(limits)) {
	failures.push('src/lib/pdf/limits.ts: local PDF ceiling must remain an explicit 20 MiB contract');
}
if (!/file_size_limit\s*=\s*"20MiB"/.test(config)) {
	failures.push('supabase/config.toml: storage file-size limit must remain aligned at 20 MiB');
}
if (
	!worker.includes("import { MAX_LOCAL_PDF_BYTES } from './limits';") ||
	!worker.includes('request.file.size > MAX_LOCAL_PDF_BYTES')
) {
	failures.push('src/lib/pdf/inspector-worker.ts: oversized local PDFs must be rejected before inspection');
}
const sizeCheck = worker.indexOf('request.file.size > MAX_LOCAL_PDF_BYTES');
const wasmInitialize = worker.indexOf('await initialize()');
const arrayBufferRead = worker.indexOf('request.file.arrayBuffer()');
if (
	sizeCheck === -1 ||
	wasmInitialize === -1 ||
	arrayBufferRead === -1 ||
	sizeCheck > wasmInitialize ||
	sizeCheck > arrayBufferRead
) {
	failures.push('src/lib/pdf/inspector-worker.ts: size validation must precede WASM initialization and file materialization');
}
if (
	!resumeStore.includes("import { MAX_LOCAL_PDF_BYTES } from './limits';") ||
	!resumeStore.includes('file.size > MAX_LOCAL_PDF_BYTES')
) {
	failures.push('src/lib/pdf/resume-store.ts: oversized PDFs must not enter resumable browser storage');
}

if (failures.length > 0) {
	console.error(`PDF upload security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('PDF upload security checks passed.');
}
