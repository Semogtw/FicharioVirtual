import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const workspaceYaml = await readFile(resolve(root, 'pnpm-workspace.yaml'), 'utf8').catch(() => '');
const failures = [];

function parsePinnedSemver(value, dependency) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '');
	if (!match) {
		failures.push(
			`${dependency}: security-sensitive dependency must use an exact semantic version`
		);
		return null;
	}
	return match.slice(1).map(Number);
}

function compareVersion(left, right) {
	for (let index = 0; index < 3; index += 1) {
		if (left[index] !== right[index]) return left[index] - right[index];
	}
	return 0;
}

function workspaceOverride(name) {
	const section = workspaceYaml.match(/^overrides:\s*\n((?:^[ \t]+[^\n]*(?:\n|$))*)/m)?.[1] ?? '';
	return section.match(new RegExp(`^[ \\t]+${name}:\\s*([^\\s#]+)\\s*$`, 'm'))?.[1];
}

const pdfjsVersion = parsePinnedSemver(packageJson.dependencies?.['pdfjs-dist'], 'pdfjs-dist');
if (pdfjsVersion && compareVersion(pdfjsVersion, [6, 2, 108]) < 0) {
	failures.push(
		'pdfjs-dist: versions below 6.2.108 are forbidden because they include the CVE-2026-16633 vulnerable range'
	);
}

const nanoidOverride = parsePinnedSemver(
	packageJson.pnpm?.overrides?.nanoid ?? workspaceOverride('nanoid'),
	'pnpm.overrides.nanoid'
);
if (nanoidOverride && compareVersion(nanoidOverride, [3, 3, 17]) < 0) {
	failures.push(
		'pnpm.overrides.nanoid: versions below 3.3.17 are forbidden because they include the CVE-2026-67213 vulnerable 3.x range'
	);
}

if (failures.length > 0) {
	console.error(`Dependency security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Dependency security checks passed.');
}
