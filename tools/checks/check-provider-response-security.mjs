import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const failures = [];
const [helper, gemini] = await Promise.all([
	readFile(join(root, 'supabase/functions/_shared/bounded-response.ts'), 'utf8'),
	readFile(join(root, 'supabase/functions/_shared/gemini-ocr-client.ts'), 'utf8')
]);

for (const required of [
	'response.body.getReader()',
	'total > maxBytes',
	"await reader.cancel('response body too large')",
	"new TextDecoder('utf-8', { fatal: true })",
	'bytes.fill(0)'
]) {
	if (!helper.includes(required)) failures.push(`bounded response reader missing ${required}`);
}

for (const required of [
	"from './bounded-response.ts'",
	'MAX_PROVIDER_ERROR_BYTES = 64 * 1024',
	'MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024',
	'readBoundedResponseText(response, MAX_PROVIDER_ERROR_BYTES)',
	'readBoundedResponseJson(response, MAX_PROVIDER_RESPONSE_BYTES)'
]) {
	if (!gemini.includes(required)) {
		failures.push(`Gemini client must keep bounded provider response contract: ${required}`);
	}
}
if (/\bresponse\.(?:json|text)\s*\(/.test(gemini)) {
	failures.push('Gemini client must not materialize unbounded provider responses');
}
if (!gemini.includes('maxOutputTokens: 8192')) {
	failures.push('Gemini single-page output token ceiling changed without security review');
}
if (!gemini.includes('Math.min(65_536, Math.max(8_192, request.pages.length * 2_048))')) {
	failures.push('Gemini batch output token ceiling changed without security review');
}

if (failures.length > 0) {
	console.error(`Provider response security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Provider response security checks passed.');
}
