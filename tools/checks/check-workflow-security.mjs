import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const workflowDirectory = join(root, '.github/workflows');
const failures = [];
const SHA_PIN = /^[0-9a-f]{40}$/;

function fail(path, rule, detail) {
	failures.push(`${relative(root, path)}: ${rule}: ${detail}`);
}

for (const name of (await readdir(workflowDirectory)).filter((entry) => /\.ya?ml$/u.test(entry))) {
	const path = join(workflowDirectory, name);
	const content = await readFile(path, 'utf8');
	const lines = content.split(/\r?\n/u);

	if (!/^permissions:\s*$/mu.test(content)) {
		fail(path, 'permissions', 'workflow must declare explicit top-level permissions');
	}
	if (/^\s*permissions:\s*write-all\s*$/im.test(content)) {
		fail(path, 'permissions', 'write-all is forbidden');
	}
	if (/^\s*pull_request_target:\s*$/im.test(content)) {
		fail(path, 'trigger', 'pull_request_target is forbidden');
	}
	if (/^\s*secrets:\s*inherit\s*$/im.test(content)) {
		fail(path, 'secret-boundary', 'secrets: inherit is forbidden');
	}
	if (/^\s*persist-credentials:\s*true\s*$/im.test(content)) {
		fail(path, 'checkout-credentials', 'persist-credentials: true is forbidden');
	}
	if (/curl[^\n|]*\|\s*(?:bash|sh)\b/iu.test(content)) {
		fail(path, 'remote-execution', 'piping a remote download directly to a shell is forbidden');
	}

	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/u);
		if (!match) continue;
		const action = match[1];
		if (action.startsWith('./') || action.startsWith('docker://')) continue;
		const separator = action.lastIndexOf('@');
		const ref = separator >= 0 ? action.slice(separator + 1) : '';
		if (!SHA_PIN.test(ref)) {
			fail(
				path,
				'action-pin',
				`line ${index + 1} must pin external action ${JSON.stringify(action)} to a full commit SHA`
			);
		}
	}
}

if (failures.length > 0) {
	console.error(`Workflow security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Workflow security checks passed.');
}
