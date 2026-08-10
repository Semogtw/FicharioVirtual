import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectWorkerStatus } from '../../../tools/desktop-worker/status.mjs';

const CREDENTIAL = 'A'.repeat(43);
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];

async function pathsFixture() {
	const root = await mkdtemp(join(tmpdir(), 'fichario-worker-status-'));
	roots.push(root);
	return {
		configDir: root,
		configPath: join(root, 'config.json'),
		devicePath: join(root, 'device.json'),
		databasePath: join(root, 'worker.db')
	};
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('inspectWorkerStatus', () => {
	it('reports setup readiness and aggregate spool state without returning credentials or OCR payloads', async () => {
		const paths = await pathsFixture();
		await writeFile(paths.databasePath, 'placeholder');
		const credentialStore = { load: vi.fn(async () => CREDENTIAL) };
		const database = {
			prepare: vi.fn((sql: string) => ({
				all: () =>
					sql.includes('result_dead_letter')
						? [
							{
								reason_code: 'desktop_ocr_completion_rejected',
								count: 2
							}
						]
						: [
							{ state: 'pending', count: 1 },
							{ state: 'accepted', count: 3 }
						]
			})),
			close: vi.fn()
		};

		const status = await inspectWorkerStatus(
			{ paths, credentialStore },
			{
				loadConfig: vi.fn(async () => ({ appOrigin: 'https://app.example.com' })),
				loadDevice: vi.fn(async () => ({
					deviceId: DEVICE_ID,
					label: 'Desktop principal',
					workerEndpoint: 'https://example.supabase.co/functions/v1/desktop-ocr-worker'
				})),
				loadLock: vi.fn(async () => ({
					backend: 'ollama',
					model: 'qwen3-vl:4b',
					digest: 'b'.repeat(64)
				})),
				databaseFactory: vi.fn(() => database)
			}
		);

		expect(status).toEqual({
			readyToRun: true,
			config: { state: 'ready', appOrigin: 'https://app.example.com' },
			device: {
				state: 'ready',
				label: 'Desktop principal',
				workerEndpoint: 'https://example.supabase.co/functions/v1/desktop-ocr-worker'
			},
			model: {
				state: 'ready',
				backend: 'ollama',
				model: 'qwen3-vl:4b',
				digest: 'b'.repeat(64)
			},
			credential: { state: 'ready' },
			spool: {
				state: 'ready',
				pending: 1,
				accepted: 3,
				rejected: 2,
				rejectionReasons: { desktop_ocr_completion_rejected: 2 }
			}
		});
		expect(JSON.stringify(status)).not.toContain(CREDENTIAL);
		expect(JSON.stringify(status)).not.toContain('rawText');
		expect(database.close).toHaveBeenCalledOnce();
	});

	it('reports missing setup files without creating a spool database or loading a credential', async () => {
		const paths = await pathsFixture();
		const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
		const credentialStore = { load: vi.fn() };
		const databaseFactory = vi.fn();

		const status = await inspectWorkerStatus(
			{ paths, credentialStore },
			{
				loadConfig: vi.fn(async () => {
					throw missing;
				}),
				loadDevice: vi.fn(async () => {
					throw missing;
				}),
				loadLock: vi.fn(async () => {
					throw missing;
				}),
				databaseFactory
			}
		);

		expect(status.readyToRun).toBe(false);
		expect(status.config.state).toBe('missing');
		expect(status.device.state).toBe('missing');
		expect(status.model.state).toBe('missing');
		expect(status.credential.state).toBe('not_applicable');
		expect(status.spool).toEqual({
			state: 'missing',
			pending: 0,
			accepted: 0,
			rejected: 0,
			rejectionReasons: {}
		});
		expect(credentialStore.load).not.toHaveBeenCalled();
		expect(databaseFactory).not.toHaveBeenCalled();
	});

	it('collapses malformed local state and keyring errors to bounded status categories', async () => {
		const paths = await pathsFixture();
		const privateFailure = new Error(`private ${CREDENTIAL}`);
		const status = await inspectWorkerStatus(
			{
				paths,
				credentialStore: {
					load: vi.fn(async () => {
						throw privateFailure;
					})
				}
			},
			{
				loadConfig: vi.fn(async () => {
					throw privateFailure;
				}),
				loadDevice: vi.fn(async () => ({ deviceId: DEVICE_ID })),
				loadLock: vi.fn(async () => {
					throw privateFailure;
				}),
				databaseFactory: vi.fn()
			}
		);

		expect(status.readyToRun).toBe(false);
		expect(status.config.state).toBe('invalid');
		expect(status.model.state).toBe('invalid');
		expect(status.credential.state).toBe('unavailable');
		expect(JSON.stringify(status)).not.toContain(CREDENTIAL);
	});
});
