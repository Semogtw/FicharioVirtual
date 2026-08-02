import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const sourceRoot = join(root, 'src');
const databaseTypesPath = join(root, 'src/lib/types/database.ts');
const sourceExtensions = new Set(['.ts', '.svelte']);

async function sourceFiles(directory) {
	const output = [];
	for (const name of await readdir(directory)) {
		const path = join(directory, name);
		const info = await stat(path);
		if (info.isDirectory()) output.push(...(await sourceFiles(path)));
		else if (sourceExtensions.has(extname(path))) output.push(path);
	}
	return output;
}

export function collectRpcCalls(content) {
	const names = new Set();
	for (const match of content.matchAll(/\.rpc\(\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
		names.add(match[1]);
	}
	return names;
}

export function collectTypedFunctions(content) {
	const functionsStart = content.indexOf('\t\tFunctions: {');
	const functionsEnd = content.indexOf('\n\t\t};\n\t\tEnums:', functionsStart);
	if (functionsStart < 0 || functionsEnd < 0) return new Set();

	const section = content.slice(functionsStart, functionsEnd);
	const names = new Set();
	for (const match of section.matchAll(/^\t\t\t([a-z][a-z0-9_]*):\s*\{/gm)) {
		names.add(match[1]);
	}
	return names;
}

const calls = new Map();
for (const path of await sourceFiles(sourceRoot)) {
	const content = await readFile(path, 'utf8');
	for (const name of collectRpcCalls(content)) {
		const locations = calls.get(name) ?? [];
		locations.push(relative(root, path));
		calls.set(name, locations);
	}
}

const databaseTypes = await readFile(databaseTypesPath, 'utf8');
const typedFunctions = collectTypedFunctions(databaseTypes);
const missing = [...calls.keys()].filter((name) => !typedFunctions.has(name)).sort();

if (missing.length > 0) {
	console.error(`RPC type drift detected (${missing.length}):`);
	for (const name of missing) {
		console.error(`- ${name}: ${calls.get(name).join(', ')}`);
	}
	process.exitCode = 1;
} else {
	console.log(`RPC type coverage passed (${calls.size} frontend RPCs).`);
}
