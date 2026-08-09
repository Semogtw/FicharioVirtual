import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const directory = join(root, 'supabase/migrations');
const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
const failures = [];
const prefixes = new Set();
const FUNCTION_START = /create\s+or\s+replace\s+function\s+public\.([a-z_][a-z0-9_]*)\s*\(/giu;

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function functionDefinitions(content) {
	const matches = [...content.matchAll(FUNCTION_START)];
	return matches.map((match, index) => ({
		name: match[1],
		body: content.slice(match.index, matches[index + 1]?.index ?? content.length)
	}));
}

for (const name of names) {
	const match = name.match(/^(\d{12})_[a-z0-9_]+\.sql$/);
	if (!match) {
		failures.push(`${name}: migration name must be YYYYMMDDHHMM_description.sql`);
		continue;
	}
	if (prefixes.has(match[1])) failures.push(`${name}: duplicate migration timestamp ${match[1]}`);
	prefixes.add(match[1]);
	const content = await readFile(join(directory, name), 'utf8');
	if (/\b(drop\s+(?:table|schema|type)|truncate\s+table)\b/i.test(content)) {
		failures.push(`${name}: destructive schema operation requires explicit reviewed exception`);
	}

	for (const definition of functionDefinitions(content)) {
		if (!/set\s+search_path\s*=\s*''/i.test(definition.body)) {
			failures.push(`${name}: function ${definition.name} missing explicit empty search_path`);
		}
		if (/security\s+definer/i.test(definition.body)) {
			const escapedName = escapeRegex(definition.name);
			const revoke = new RegExp(
				`revoke\\s+execute\\s+on\\s+function\\s+public\\.${escapedName}\\s*\\(`,
				'iu'
			);
			if (!revoke.test(content)) {
				failures.push(
					`${name}: SECURITY DEFINER function ${definition.name} missing its own execute revocation`
				);
			}
		}
	}

	if (/grant\s+execute\s+on\s+function\s+[^;]+?\s+to\s+(?:public|anon)\b[^;]*;/iu.test(content)) {
		failures.push(`${name}: function execution must never be granted to public or anon`);
	}
}

if (names.length === 0) failures.push(`${basename(directory)}: no migrations found`);

if (failures.length > 0) {
	console.error(`Migration checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log(`Migration checks passed (${names.length} files).`);
}
