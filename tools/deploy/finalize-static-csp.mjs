import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const build = join(root, 'build');
const headersPath = join(build, '_headers');

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listHtmlFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listHtmlFiles(path)));
		} else if (entry.isFile() && entry.name.endsWith('.html')) {
			files.push(path);
		}
	}
	return files;
}

/**
 * @param {string} html
 * @returns {string[]}
 */
function inlineScripts(html) {
	const scripts = [];
	const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
	for (const match of html.matchAll(pattern)) {
		const attributes = match[1] ?? '';
		const source = match[2] ?? '';
		if (/\bsrc\s*=/i.test(attributes) || source.trim() === '') continue;
		scripts.push(source);
	}
	return scripts;
}

/**
 * @param {string} source
 * @returns {string}
 */
function scriptHash(source) {
	const digest = createHash('sha256').update(source, 'utf8').digest('base64');
	return `'sha256-${digest}'`;
}

/**
 * @param {string} source
 * @param {string[]} hashes
 * @returns {string}
 */
function withScriptHashes(source, hashes) {
	const lines = source.split(/\r?\n/);
	const rootIndex = lines.findIndex((line) => line.trim() === '/*');
	if (rootIndex < 0) throw new Error('_headers is missing the /* root rule');

	let cspIndex = -1;
	for (let index = rootIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim() === '' || !/^\s+/.test(line)) break;
		if (/^\s*Content-Security-Policy\s*:/i.test(line)) {
			cspIndex = index;
			break;
		}
	}
	if (cspIndex < 0) throw new Error('_headers root rule is missing Content-Security-Policy');

	const separator = lines[cspIndex].indexOf(':');
	const prefix = lines[cspIndex].slice(0, separator + 1);
	const csp = lines[cspIndex].slice(separator + 1).trim();
	const directives = csp
		.split(';')
		.map((directive) => directive.trim())
		.filter(Boolean);
	const scriptIndex = directives.findIndex((directive) => /^script-src(?:\s|$)/i.test(directive));
	if (scriptIndex < 0) throw new Error('Content-Security-Policy is missing script-src');

	const tokens = directives[scriptIndex].split(/\s+/);
	const name = tokens.shift();
	const stableTokens = tokens.filter((token) => !/^'sha256-[A-Za-z0-9+/]+=*'$/.test(token));
	if (stableTokens.includes("'unsafe-inline'")) {
		throw new Error("Content-Security-Policy script-src must not use 'unsafe-inline'");
	}
	directives[scriptIndex] = [name, ...stableTokens, ...hashes].join(' ');
	lines[cspIndex] = `${prefix} ${directives.join('; ')}`;
	return `${lines.join('\n').replace(/\n*$/, '')}\n`;
}

const hashes = new Set();
const htmlFiles = await listHtmlFiles(build);
for (const file of htmlFiles) {
	const html = await readFile(file, 'utf8');
	for (const source of inlineScripts(html)) hashes.add(scriptHash(source));
}

if (hashes.size === 0) {
	throw new Error('Static build contains no inline bootstrap scripts to authorize');
}

const sortedHashes = [...hashes].sort();
const headers = await readFile(headersPath, 'utf8');
await writeFile(headersPath, withScriptHashes(headers, sortedHashes), 'utf8');

console.log(
	`Finalized static CSP with ${sortedHashes.length} inline-script hash${sortedHashes.length === 1 ? '' : 'es'} across ${htmlFiles.length} HTML file${htmlFiles.length === 1 ? '' : 's'}.`
);
for (const file of htmlFiles) {
	console.log(`- ${relative(build, file)}`);
}
