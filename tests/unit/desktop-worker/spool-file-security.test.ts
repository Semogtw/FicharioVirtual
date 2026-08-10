import { lstat, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ResultSpool } from '../../../tools/desktop-worker/spool.mjs';

const roots: string[] = [];
const spools: ResultSpool[] = [];

async function rootFixture() {
	const root = await mkdtemp(join(tmpdir(), 'fichario-worker-spool-file-'));
	roots.push(root);
	return root;
}

afterEach(async () => {
	while (spools.length) spools.pop()?.close();
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('desktop worker spool file security', () => {
	it('creates a missing SQLite file with mode 0600 before normal use', async () => {
		const root = await rootFixture();
		const path = join(root, 'worker.db');
		const spool = new ResultSpool(path);
		spools.push(spool);

		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await lstat(path)).isSymbolicLink()).toBe(false);
	});

	it('tightens an existing regular file before SQLite opens it', async () => {
		const root = await rootFixture();
		const path = join(root, 'worker.db');
		await writeFile(path, '', { mode: 0o644 });
		const spool = new ResultSpool(path);
		spools.push(spool);

		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it('refuses a symlink spool path instead of following it', async () => {
		const root = await rootFixture();
		const target = join(root, 'target.db');
		const path = join(root, 'worker.db');
		await writeFile(target, 'do-not-touch', { mode: 0o600 });
		await symlink(target, path);

		expect(() => new ResultSpool(path)).toThrow();
		expect(await lstat(path)).toMatchObject({});
		expect((await stat(target)).size).toBe('do-not-touch'.length);
	});
});
