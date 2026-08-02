import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

const root = resolve(new URL('../..', import.meta.url).pathname);
const workflowPath = join(root, '.github/workflows/validate-current-head.yml');
const restoreScriptPath = join(root, 'tools/lockfile/restore-pnpm-lockfile.sh');
const lockfilePartsDirectory = join(root, 'tools/lockfile');
const failures = [];
const unzip = promisify(gunzip);

function fail(detail) {
	failures.push(detail);
}

const workflow = await readFile(workflowPath, 'utf8');
const restoreStep = workflow.indexOf('bash tools/lockfile/restore-pnpm-lockfile.sh');
const setupNodeStep = workflow.indexOf('uses: actions/setup-node@');
const installStep = workflow.indexOf('pnpm install --frozen-lockfile');

if (restoreStep === -1) {
	fail('workflow must restore pnpm-lock.yaml before package-manager setup');
}
if (setupNodeStep === -1) {
	fail('workflow must configure Node.js');
}
if (installStep === -1) {
	fail('workflow must install dependencies from a frozen lockfile');
}
if (restoreStep !== -1 && setupNodeStep !== -1 && restoreStep > setupNodeStep) {
	fail('lockfile restoration must run before actions/setup-node enables the pnpm cache');
}
if (restoreStep !== -1 && installStep !== -1 && restoreStep > installStep) {
	fail('lockfile restoration must run before pnpm install');
}

let restoreScript = '';
try {
	restoreScript = await readFile(restoreScriptPath, 'utf8');
} catch {
	fail('tools/lockfile/restore-pnpm-lockfile.sh is missing');
}

if (restoreScript) {
	for (const required of ['pnpm-lock.yaml.gz.b64.part-*', 'base64 --decode', 'gzip -dc']) {
		if (!restoreScript.includes(required)) {
			fail(`lockfile restore script is missing ${required}`);
		}
	}
}

const partNames = (await readdir(lockfilePartsDirectory))
	.filter((name) => /^pnpm-lock\.yaml\.gz\.b64\.part-\d{2}$/.test(name))
	.sort();

if (partNames.length === 0) {
	fail('no reproducible lockfile archive parts were found');
} else {
	for (const [index, name] of partNames.entries()) {
		const expected = `pnpm-lock.yaml.gz.b64.part-${String(index).padStart(2, '0')}`;
		if (name !== expected) fail(`lockfile archive sequence is not contiguous: expected ${expected}, found ${name}`);
	}

	try {
		const encodedParts = await Promise.all(
			partNames.map((name) => readFile(join(lockfilePartsDirectory, name), 'utf8'))
		);
		const compressed = Buffer.from(encodedParts.join('').replace(/\s+/g, ''), 'base64');
		const lockfile = (await unzip(compressed)).toString('utf8');
		if (!/^lockfileVersion:/m.test(lockfile)) fail('restored content is not a pnpm lockfile');
		if (!lockfile.includes('@sveltejs/kit')) fail('restored lockfile does not contain application dependencies');
	} catch (error) {
		fail(`lockfile archive cannot be decoded and decompressed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

if (failures.length > 0) {
	console.error(`CI bootstrap checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log(`CI bootstrap checks passed with ${partNames.length} lockfile archive parts.`);
}
