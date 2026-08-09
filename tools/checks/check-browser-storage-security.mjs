import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(new URL('../..', import.meta.url).pathname);
const sourceRoot = join(root, 'src');
const extensions = new Set(['.ts', '.js', '.svelte']);
const failures = [];
const allowedLocalStorage = new Set([
	'src/lib/import/browser-exclusive.ts',
	'src/lib/review/draft-index.ts',
	'src/lib/theme/theme.ts'
]);
const allowedIndexedDb = new Set(['src/lib/import/resume-database.ts']);

async function sourceFiles(directory) {
	const output = [];
	for (const name of await readdir(directory)) {
		const path = join(directory, name);
		const information = await stat(path);
		if (information.isDirectory()) output.push(...(await sourceFiles(path)));
		else if (extensions.has(extname(path))) output.push(path);
	}
	return output;
}

for (const path of await sourceFiles(sourceRoot)) {
	const repositoryPath = relative(root, path).replaceAll('\\', '/');
	const content = await readFile(path, 'utf8');
	if (/\bsessionStorage\b/.test(content)) {
		failures.push(`${repositoryPath}: sessionStorage is forbidden for application persistence`);
	}
	if (/\blocalStorage\b/.test(content) && !allowedLocalStorage.has(repositoryPath)) {
		failures.push(`${repositoryPath}: localStorage use requires an explicit reviewed allowlist entry`);
	}
	if (/\bindexedDB\b/.test(content) && !allowedIndexedDb.has(repositoryPath)) {
		failures.push(`${repositoryPath}: direct IndexedDB access is restricted to the resume database`);
	}
}

const drafts = await readFile(join(root, 'src/lib/review/drafts.ts'), 'utf8');
const draftIndex = await readFile(join(root, 'src/lib/review/draft-index.ts'), 'utf8');
if (!drafts.includes("const PREFIX = 'fichario:correction-draft:v2:'")) {
	failures.push('src/lib/review/drafts.ts: correction drafts must keep the account-scoped v2 namespace');
}
if (!drafts.includes('userId: ownerUserId') || !drafts.includes('record.userId !== expectedUserId')) {
	failures.push('src/lib/review/drafts.ts: stored correction drafts must bind and verify the owning user');
}
if (!draftIndex.includes('correctionDraftKey(userId, pageId)')) {
	failures.push('src/lib/review/draft-index.ts: correction draft reads must derive keys from userId');
}

const resumeDatabase = await readFile(join(root, 'src/lib/import/resume-database.ts'), 'utf8');
const imageResume = await readFile(join(root, 'src/lib/import/resume-store.ts'), 'utf8');
const pdfResume = await readFile(join(root, 'src/lib/pdf/resume-store.ts'), 'utf8');
if (!resumeDatabase.includes("store.index('userId').getAll(userId)")) {
	failures.push('src/lib/import/resume-database.ts: resumable files must be queried through the userId index');
}
for (const [name, content] of [
	['src/lib/import/resume-store.ts', imageResume],
	['src/lib/pdf/resume-store.ts', pdfResume]
]) {
	if (!content.includes('store.list(ownerId)')) {
		failures.push(`${name}: resumable-file reads must scope the database query to the current account`);
	}
}

if (failures.length > 0) {
	console.error(`Browser storage security checks failed (${failures.length}):`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Browser storage security checks passed.');
}
