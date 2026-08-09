import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const sourceRoot = join(root, 'src');
const headersPath = join(root, 'static/_headers');
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.svelte']);
const forbiddenPdfScriptingTokens = [
	'PDFScriptingManager',
	'pdf.sandbox',
	'getJSActions(',
	'hasJSActions('
];
const failures = [];

async function walk(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(path)));
		else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(path);
	}
	return files;
}

for (const path of await walk(sourceRoot)) {
	const content = await readFile(path, 'utf8');
	for (const token of forbiddenPdfScriptingTokens) {
		if (content.includes(token)) {
			failures.push(
				`${relative(root, path)}: PDF viewer scripting boundary token ${JSON.stringify(token)} is forbidden`
			);
		}
	}
}

const headers = await readFile(headersPath, 'utf8');
const cspLine = headers
	.split(/\r?\n/u)
	.find((line) => line.trimStart().startsWith('Content-Security-Policy:'));
if (!cspLine) {
	failures.push('static/_headers: Content-Security-Policy is required');
} else {
	const scriptDirective = cspLine
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith('script-src '));
	if (!scriptDirective) {
		failures.push('static/_headers: explicit script-src directive is required');
	} else {
		if (scriptDirective.includes("'unsafe-eval'")) {
			failures.push("static/_headers: script-src must not allow 'unsafe-eval'");
		}
		if (scriptDirective.includes("'unsafe-inline'")) {
			failures.push("static/_headers: script-src must not allow 'unsafe-inline'");
		}
		if (/\s(?:\*|data:)(?:\s|$)/u.test(scriptDirective)) {
			failures.push('static/_headers: script-src must not allow wildcard or data: script sources');
		}
	}
}

if (failures.length > 0) {
	console.error(`PDF.js security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('PDF.js security checks passed.');
}
