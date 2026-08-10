import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveDeviceMetadata } from '../../../tools/desktop-worker/device.mjs';
import {
	ensureWorkerDirectories,
	resolveWorkerPaths
} from '../../../tools/desktop-worker/paths.mjs';
import {
	WorkerRuntimeError,
	createWorkerRuntime
} from '../../../tools/desktop-worker/runtime.mjs';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL = 'A'.repeat(43);
const ENDPOINT = 'https://example.supabase.co/functions/v1/desktop-ocr-worker';
const roots: string[] = [];

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'fichario-worker-runtime-'));
	roots.push(root);
	const home = join(root, 'home');
	const paths = resolveWorkerPaths(
		{
			XDG_CONFIG_HOME: join(root, 'config'),
			XDG_CACHE_HOME: join(root, 'cache'),
			XDG_STATE_HOME: join(root, 'state')
		},
		home
	);
	await ensureWorkerDirectories(paths);
	await writeFile(
		paths.configPath,
		JSON.stringify({
			schemaVersion: 1,
			appOrigin: 'https://app.example.com',
			backendPreference: ['cpu'],
			maxConcurrency: 1,
			pollIntervalSeconds: 30,
			idlePollIntervalSeconds: 300,
			modelChannel: 'stable',
			keepCompletedSpoolHours: 24
		}),
		{ mode: 0o600 }
	);
	await saveDeviceMetadata(paths.devicePath, {
		schemaVersion: 1,
		deviceId: DEVICE_ID,
		label: 'Desktop principal',
		workerEndpoint: ENDPOINT,
		createdAt: '2026-08-10T02:00:00.000Z'
	});
	return paths;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('createWorkerRuntime', () => {
	it('loads the credential from Secret Service and exposes only composed runtime objects', async () => {
		const paths = await fixture();
		const credentialStore = { load: vi.fn(async () => CREDENTIAL) };
		const client = { claim: vi.fn(), renew: vi.fn(), source: vi.fn(), complete: vi.fn() };
		const clientFactory = vi.fn(() => client);
		const spool = { close: vi.fn() };
		const spoolFactory = vi.fn(() => spool);
		const engine = { process: vi.fn() };

		const runtime = await createWorkerRuntime(
			{ engine, paths, credentialStore },
			{ clientFactory, spoolFactory }
		);

		expect(credentialStore.load).toHaveBeenCalledWith(DEVICE_ID, { signal: undefined });
		expect(clientFactory).toHaveBeenCalledWith({ endpoint: ENDPOINT, credential: CREDENTIAL });
		expect(spoolFactory).toHaveBeenCalledWith(paths.databasePath);
		expect(runtime.context).toEqual({ client, spool, engine, downloadsDir: paths.downloadsDir });
		expect(runtime.device.deviceId).toBe(DEVICE_ID);
		expect(JSON.stringify(runtime)).not.toContain(CREDENTIAL);
		expect((await stat(paths.databasePath)).mode & 0o777).toBe(0o600);
		runtime.close();
		runtime.close();
		expect(spool.close).toHaveBeenCalledOnce();
	});

	it('fails closed before creating a client or spool when the keyring entry is missing', async () => {
		const paths = await fixture();
		const clientFactory = vi.fn();
		const spoolFactory = vi.fn();
		const error = await createWorkerRuntime(
			{
				engine: { process: vi.fn() },
				paths,
				credentialStore: { load: vi.fn(async () => null) }
			},
			{ clientFactory, spoolFactory }
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(WorkerRuntimeError);
		expect(error.code).toBe('worker_credential_missing');
		expect(clientFactory).not.toHaveBeenCalled();
		expect(spoolFactory).not.toHaveBeenCalled();
	});

	it('keeps config and device files free of worker credentials', async () => {
		const paths = await fixture();
		const config = await readFile(paths.configPath, 'utf8');
		const device = await readFile(paths.devicePath, 'utf8');
		expect(config).not.toContain(CREDENTIAL);
		expect(device).not.toContain(CREDENTIAL);
		expect(config.toLowerCase()).not.toContain('credential');
		expect(device.toLowerCase()).not.toContain('credential');
	});

	it('closes an already-created spool when a later runtime factory step fails', async () => {
		const paths = await fixture();
		const spool = { close: vi.fn() };
		const spoolFactory = vi.fn(() => spool);
		const clientFactory = vi.fn(() => {
			throw new Error('synthetic client failure');
		});

		await expect(
			createWorkerRuntime(
				{
					engine: { process: vi.fn() },
					paths,
					credentialStore: { load: vi.fn(async () => CREDENTIAL) }
				},
				{ clientFactory, spoolFactory }
			)
		).rejects.toThrow('synthetic client failure');
		expect(spoolFactory).not.toHaveBeenCalled();
		expect(spool.close).not.toHaveBeenCalled();
	});
});
