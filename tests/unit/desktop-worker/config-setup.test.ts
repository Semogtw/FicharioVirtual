import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	ConfigSetupError,
	defaultWorkerConfig,
	initializeWorkerConfig
} from '../../../tools/desktop-worker/config-setup.mjs';
import { resolveWorkerPaths } from '../../../tools/desktop-worker/paths.mjs';

const roots: string[] = [];

async function pathsFixture() {
	const root = await mkdtemp(join(tmpdir(), 'fichario-worker-config-setup-'));
	roots.push(root);
	return resolveWorkerPaths(
		{
			XDG_CONFIG_HOME: join(root, 'config'),
			XDG_CACHE_HOME: join(root, 'cache'),
			XDG_STATE_HOME: join(root, 'state')
		},
		join(root, 'home')
	);
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('defaultWorkerConfig', () => {
	it('uses conservative single-worker CPU-safe defaults', () => {
		expect(defaultWorkerConfig('https://app.example.com')).toEqual({
			schemaVersion: 1,
			appOrigin: 'https://app.example.com',
			backendPreference: ['cpu'],
			maxConcurrency: 1,
			pollIntervalSeconds: 30,
			idlePollIntervalSeconds: 300,
			modelChannel: 'stable',
			keepCompletedSpoolHours: 24
		});
	});

	it('inherits strict HTTPS origin validation from the runtime config contract', () => {
		expect(() => defaultWorkerConfig('http://app.example.com')).toThrow('appOrigin');
		expect(() => defaultWorkerConfig('https://user:pass@app.example.com')).toThrow('appOrigin');
		expect(() => defaultWorkerConfig('https://app.example.com/path')).toThrow('appOrigin');
	});
});

describe('initializeWorkerConfig', () => {
	it('creates the config exactly once with private permissions', async () => {
		const paths = await pathsFixture();
		const result = await initializeWorkerConfig('https://app.example.com', {
			paths,
			now: () => new Date('2026-08-10T03:00:00.000Z')
		});

		expect(result.createdAt).toBe('2026-08-10T03:00:00.000Z');
		expect((await stat(paths.configPath)).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readFile(paths.configPath, 'utf8'))).toEqual(result.config);
	});

	it('never overwrites an existing config file', async () => {
		const paths = await pathsFixture();
		await initializeWorkerConfig('https://first.example.com', { paths });
		const before = await readFile(paths.configPath, 'utf8');

		const error = await initializeWorkerConfig('https://second.example.com', { paths }).catch(
			(caught) => caught
		);

		expect(error).toBeInstanceOf(ConfigSetupError);
		expect(error.code).toBe('worker_config_exists');
		expect(await readFile(paths.configPath, 'utf8')).toBe(before);
	});

	it('preserves a pre-existing non-config file instead of truncating it', async () => {
		const paths = await pathsFixture();
		await writeFile(paths.configPath, 'do-not-overwrite', { mode: 0o600 });

		await expect(
			initializeWorkerConfig('https://app.example.com', { paths })
		).rejects.toMatchObject({ code: 'worker_config_exists' });
		expect(await readFile(paths.configPath, 'utf8')).toBe('do-not-overwrite');
	});
});
