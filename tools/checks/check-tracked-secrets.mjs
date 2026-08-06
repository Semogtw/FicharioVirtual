import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import process from 'node:process';

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const textExtensions = new Set([
	'.cjs',
	'.css',
	'.html',
	'.js',
	'.json',
	'.md',
	'.mjs',
	'.sh',
	'.sql',
	'.svelte',
	'.svg',
	'.ts',
	'.txt',
	'.yaml',
	'.yml'
]);
const ignoredPaths = new Set(['tools/checks/check-tracked-secrets.mjs']);
const patterns = [
	{
		name: 'Google API key',
		pattern: new RegExp('AI' + 'za[0-9A-Za-z_-]{20,}', 'g')
	},
	{
		name: 'GitHub token',
		pattern: new RegExp('gh' + '[pousr]_[A-Za-z0-9]{30,}', 'g')
	},
	{
		name: 'OpenAI API key',
		pattern: new RegExp('sk' + '-(?:proj-)?[A-Za-z0-9_-]{20,}', 'g')
	},
	{
		name: 'AWS access key',
		pattern: new RegExp('AK' + 'IA[0-9A-Z]{16}', 'g')
	}
];

function isTextPath(path) {
	if (path.startsWith('.git/') || ignoredPaths.has(path)) return false;
	const extension = extname(path).toLowerCase();
	return textExtensions.has(extension) || path.startsWith('.env');
}

const { stdout } = await execFileAsync('git', ['ls-files', '-z'], {
	encoding: 'utf8',
	maxBuffer: 16 * 1024 * 1024
});
const failures = [];

for (const path of stdout.split('\0').filter(Boolean)) {
	if (!isTextPath(path)) continue;
	const information = await stat(path);
	if (!information.isFile() || information.size > MAX_FILE_BYTES) continue;
	const content = await readFile(path, 'utf8');
	for (const { name, pattern } of patterns) {
		pattern.lastIndex = 0;
		const match = pattern.exec(content);
		if (match) failures.push(`${path}: ${name} at byte ${match.index}`);
	}
}

if (failures.length > 0) {
	console.error(`Tracked secret checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Tracked secret checks passed.');
}
