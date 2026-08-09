import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const directory = join(root, 'supabase/migrations');
const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
const failures = [];
const prefixes = new Set();
const FUNCTION_START = /create\s+or\s+replace\s+function\s+public\.([a-z_][a-z0-9_]*)\s*\(/giu;
const TABLE_CREATE = /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z_][a-z0-9_]*)\b/giu;
const migrations = await Promise.all(
	names.map(async (name) => ({ name, content: await readFile(join(directory, name), 'utf8') }))
);

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

function laterMigrationSource(migrationIndex) {
	return migrations
		.slice(migrationIndex)
		.map((migration) => migration.content)
		.join('\n');
}

function hasEffectivePublicExecuteRevocation(functionName, migrationIndex) {
	const escapedName = escapeRegex(functionName);
	const laterSource = laterMigrationSource(migrationIndex);
	const explicitRevocation = new RegExp(
		`revoke\\s+(?:all|execute)\\s+on\\s+function\\s+public\\.${escapedName}\\s*\\([^;]*?\\)\\s+from\\s+(?:[^;]*?\\bpublic\\b)`,
		'iu'
	);
	if (explicitRevocation.test(laterSource)) return true;

	const convertedToInvoker = new RegExp(
		`alter\\s+function\\s+public\\.${escapedName}\\s*\\([^;]*?\\)\\s+security\\s+invoker\\s*;`,
		'iu'
	);
	return convertedToInvoker.test(laterSource);
}

function tableRlsState(tableName, migrationIndex) {
	const escapedName = escapeRegex(tableName);
	const laterSource = laterMigrationSource(migrationIndex);
	return Object.freeze({
		enabled: new RegExp(
			`alter\\s+table\\s+public\\.${escapedName}\\s+enable\\s+row\\s+level\\s+security\\s*;`,
			'iu'
		).test(laterSource),
		forced: new RegExp(
			`alter\\s+table\\s+public\\.${escapedName}\\s+force\\s+row\\s+level\\s+security\\s*;`,
			'iu'
		).test(laterSource)
	});
}

for (const [migrationIndex, { name, content }] of migrations.entries()) {
	const match = name.match(/^(\d{12})_[a-z0-9_]+\.sql$/);
	if (!match) {
		failures.push(`${name}: migration name must be YYYYMMDDHHMM_description.sql`);
		continue;
	}
	if (prefixes.has(match[1])) failures.push(`${name}: duplicate migration timestamp ${match[1]}`);
	prefixes.add(match[1]);
	if (/\b(drop\s+(?:table|schema|type)|truncate\s+table)\b/i.test(content)) {
		failures.push(`${name}: destructive schema operation requires explicit reviewed exception`);
	}

	for (const table of content.matchAll(TABLE_CREATE)) {
		const tableName = table[1];
		const rls = tableRlsState(tableName, migrationIndex);
		if (!rls.enabled) {
			failures.push(`${name}: public table ${tableName} never enables row level security`);
		}
		if (!rls.forced) {
			failures.push(`${name}: public table ${tableName} never forces row level security`);
		}
	}

	for (const definition of functionDefinitions(content)) {
		if (!/set\s+search_path\s*=\s*''/i.test(definition.body)) {
			failures.push(`${name}: function ${definition.name} missing explicit empty search_path`);
		}
		if (
			/security\s+definer/i.test(definition.body) &&
			!hasEffectivePublicExecuteRevocation(definition.name, migrationIndex)
		) {
			failures.push(
				`${name}: SECURITY DEFINER function ${definition.name} remains executable by PUBLIC without a later invoker conversion`
			);
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
