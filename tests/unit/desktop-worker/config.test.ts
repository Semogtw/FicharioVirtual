import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWorkerConfig, parseWorkerConfig } from '../../../tools/desktop-worker/config.mjs';
import {
	ensurePrivateFile,
	ensureWorkerDirectories,
	resolveWorkerPaths
} from '../../../tools/desktop-worker/paths.mjs';

const validConfig = () => ({
	schemaVersion: 1,
	appOrigin: 'https://fichario.example.com',
	backendPreference: ['vulkan', 'cpu'],
	maxConcurrency: 1,
	pollIntervalSeconds: 30,
	idlePollIntervalSeconds: 300,
	modelChannel: 'stable',
	keepCompletedSpoolHours: 24
});

describe('desktop worker config', () => {
	it('accepts the documented strict schema', () => {
		expect(parseWorkerConfig(validConfig())).toEqual(validConfig());
	});

	it.each([
		['unknown key', { ...validConfig(), token: 'forbidden' }],
		['http origin', { ...validConfig(), appOrigin: 'http://fichario.example.com' }],
		['origin path', { ...validConfig(), appOrigin: 'https://fichario.example.com/app' }],
		['credentials', { ...validConfig(), appOrigin: 'https://user:pass@fichario.example.com' }],
		['missing CPU fallback', { ...validConfig(), backendPreference: ['vulkan'] }],
		['duplicate backend', { ...validConfig(), backendPreference: ['cpu', 'cpu'] }],
		['parallel jobs', { ...validConfig(), maxConcurrency: 2 }],
		['unknown model channel', { ...validConfig(), modelChannel: 'nightly' }]
	])('rejects %s fail-closed', (_name, config) => {
		expect(() => parseWorkerConfig(config)).toThrow();
	});

	it('bounds config file size and parses JSON from disk', async () => {
		const root = await mkdtemp(join(tmpdir(), 'fichario-worker-config-'));
		const path = join(root, 'config.json');
		await writeFile(path, JSON.stringify(validConfig()), { mode: 0o600 });
		await expect(loadWorkerConfig(path)).resolves.toEqual(validConfig());
		await writeFile(path, 'x'.repeat(64 * 1024 + 1), { mode: 0o600 });
		await expect(loadWorkerConfig(path)).rejects.toThrow('too large');
	});
});

describe('desktop worker XDG paths', () => {
	it('creates only private directories and files', async () => {
		const root = await mkdtemp(join(tmpdir(), 'fichario-worker-paths-'));
		const paths = resolveWorkerPaths(
			{
				XDG_CONFIG_HOME: join(root, 'config'),
				XDG_CACHE_HOME: join(root, 'cache'),
				XDG_STATE_HOME: join(root, 'state')
			},
			root
		);
		await ensureWorkerDirectories(paths);
		await ensurePrivateFile(paths.devicePath);

		for (const directory of [paths.configDir, paths.cacheDir, paths.stateDir, paths.spoolDir]) {
			expect((await stat(directory)).mode & 0o777).toBe(0o700);
		}
		expect((await stat(paths.devicePath)).mode & 0o777).toBe(0o600);
	});
});
