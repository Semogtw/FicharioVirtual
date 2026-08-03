import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const workflowPath = join(root, '.github/workflows/validate-current-head.yml');
const packagePath = join(root, 'package.json');
const lockfilePath = join(root, 'pnpm-lock.yaml');
const gitignorePath = join(root, '.gitignore');
const failures = [];

function fail(detail) {
	failures.push(detail);
}

const [workflow, packageSource, lockfile, gitignore] = await Promise.all([
	readFile(workflowPath, 'utf8'),
	readFile(packagePath, 'utf8'),
	readFile(lockfilePath, 'utf8'),
	readFile(gitignorePath, 'utf8')
]);
const manifest = JSON.parse(packageSource);

if (!/^lockfileVersion:\s*['"]?9(?:\.0)?['"]?\s*$/m.test(lockfile)) {
	fail('pnpm-lock.yaml must use lockfile version 9');
}
if (!/^importers:\s*$/m.test(lockfile) || !lockfile.includes('\n  .:\n')) {
	fail('pnpm-lock.yaml must contain the root importer');
}

for (const section of ['dependencies', 'devDependencies']) {
	for (const dependency of Object.keys(manifest[section] ?? {})) {
		const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (!new RegExp(`^\\s{6}['"]?${escaped}['"]?:\\s*$`, 'm').test(lockfile)) {
			fail(`pnpm-lock.yaml is missing ${section}.${dependency}`);
		}
	}
}

const setupNodeStep = workflow.indexOf('uses: actions/setup-node@');
const installStep = workflow.indexOf('pnpm install --frozen-lockfile');
if (setupNodeStep === -1) fail('workflow must configure Node.js');
if (!/uses:\s*actions\/setup-node@[^\n]+[\s\S]*?cache:\s*pnpm/.test(workflow)) {
	fail('workflow must enable the pnpm cache through actions/setup-node');
}
if (installStep === -1) fail('workflow must install dependencies from a frozen lockfile');
if (setupNodeStep !== -1 && installStep !== -1 && setupNodeStep > installStep) {
	fail('actions/setup-node must run before pnpm install');
}
if (workflow.includes('restore-pnpm-lockfile') || workflow.includes('pnpm-lock.yaml.gz.b64')) {
	fail('workflow must use the versioned root lockfile without a restoration layer');
}

if (!/uses:\s*actions\/checkout@[^\n]+[\s\S]*?persist-credentials:\s*false/.test(workflow)) {
	fail('workflow checkout must disable persisted Git credentials');
}

const supabaseSetup = workflow.match(
	/uses:\s*supabase\/setup-cli@(v\d+)\s*\n\s*with:\s*\n\s*version:\s*([^\s#]+)/
);
if (!supabaseSetup) {
	fail('workflow must configure Supabase CLI with an explicit action and CLI version');
} else {
	const [, actionVersion, cliVersion] = supabaseSetup;
	if (actionVersion !== 'v2') fail('workflow must use supabase/setup-cli@v2');
	if (!/^\d+\.\d+\.\d+$/.test(cliVersion)) {
		fail('Supabase CLI must use an exact semantic version instead of latest');
	}
}

if (/^pnpm-lock\.yaml\/?\s*$/m.test(gitignore)) {
	fail('pnpm-lock.yaml must remain versioned and cannot be ignored');
}

if (failures.length > 0) {
	console.error(`CI bootstrap checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('CI bootstrap checks passed with pinned package-manager and Supabase tooling.');
}
