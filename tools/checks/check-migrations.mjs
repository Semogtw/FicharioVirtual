import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const directory = join(root, 'supabase/migrations');
const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
const failures = [];
const prefixes = new Set();

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
	if (/create\s+or\s+replace\s+function/i.test(content) && !/set\s+search_path\s*=\s*''/i.test(content)) {
		failures.push(`${name}: function definition missing explicit empty search_path`);
	}
	if (/security\s+definer/i.test(content) && !/revoke\s+execute/i.test(content)) {
		failures.push(`${name}: SECURITY DEFINER function missing explicit execute revocation`);
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
