import { describe, expect, it, vi } from 'vitest';
import {
	WorkerUnpairError,
	runUnpairCli,
	unpairFromLocalState
} from '../../../tools/desktop-worker/unpair-command.mjs';

const ACCESS_TOKEN = 'header.payload.signature';
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_ENDPOINT = 'https://example.supabase.co/functions/v1/desktop-ocr-worker';
const DEVICE_PATH = '/tmp/fichario-worker/device.json';

function device() {
	return {
		schemaVersion: 1,
		deviceId: DEVICE_ID,
		label: 'Desktop principal',
		workerEndpoint: WORKER_ENDPOINT,
		createdAt: '2026-08-10T02:00:00.000Z'
	};
}

function revoked() {
	return {
		deviceId: DEVICE_ID,
		status: 'revoked',
		revokedAt: '2026-08-10T03:00:00.000Z',
		requeuedJobs: 2
	};
}

function sink() {
	let value = '';
	return {
		write(chunk: unknown) {
			value += String(chunk);
			return true;
		},
		read: () => value
	};
}

describe('unpairFromLocalState', () => {
	it('revokes remotely before removing local credential and metadata', async () => {
		const order: string[] = [];
		const credentialStore = {
			clear: vi.fn(async () => {
				order.push('credential');
				return true;
			})
		};
		const revoke = vi.fn(async (request) => {
			order.push('remote');
			expect(request).toEqual({
				workerEndpoint: WORKER_ENDPOINT,
				deviceId: DEVICE_ID,
				accessToken: ACCESS_TOKEN
			});
			return revoked();
		});
		const removeMetadata = vi.fn(async (path) => {
			order.push('metadata');
			expect(path).toBe(DEVICE_PATH);
		});

		const result = await unpairFromLocalState(
			{
				accessToken: ACCESS_TOKEN,
				paths: { devicePath: DEVICE_PATH },
				credentialStore
			},
			{
				loadDevice: vi.fn(async () => device()),
				revoke,
				removeMetadata
			}
		);

		expect(order).toEqual(['remote', 'credential', 'metadata']);
		expect(result).toEqual({
			deviceId: DEVICE_ID,
			label: 'Desktop principal',
			status: 'revoked',
			revokedAt: '2026-08-10T03:00:00.000Z',
			requeuedJobs: 2
		});
		expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
	});

	it('does not delete local state if remote revocation fails', async () => {
		const credentialStore = { clear: vi.fn() };
		const removeMetadata = vi.fn();
		const remoteFailure = new Error('remote revoke failed');

		await expect(
			unpairFromLocalState(
				{
					accessToken: ACCESS_TOKEN,
					paths: { devicePath: DEVICE_PATH },
					credentialStore
				},
				{
					loadDevice: vi.fn(async () => device()),
					revoke: vi.fn(async () => {
						throw remoteFailure;
					}),
					removeMetadata
				}
			)
		).rejects.toBe(remoteFailure);
		expect(credentialStore.clear).not.toHaveBeenCalled();
		expect(removeMetadata).not.toHaveBeenCalled();
	});

	it('keeps device metadata when local cleanup is incomplete so idempotent revoke can be retried', async () => {
		const credentialStore = {
			clear: vi.fn(async () => {
				throw new Error('secret service unavailable');
			})
		};
		const removeMetadata = vi.fn();
		const error = await unpairFromLocalState(
			{
				accessToken: ACCESS_TOKEN,
				paths: { devicePath: DEVICE_PATH },
				credentialStore
			},
			{
				loadDevice: vi.fn(async () => device()),
				revoke: vi.fn(async () => revoked()),
				removeMetadata
			}
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(WorkerUnpairError);
		expect(error.code).toBe('worker_unpair_local_cleanup_failed');
		expect(removeMetadata).not.toHaveBeenCalled();
	});

	it('returns a safe missing-device code for an absent local pairing', async () => {
		const missing = Object.assign(new Error('/private/device.json'), { code: 'ENOENT' });
		const error = await unpairFromLocalState(
			{
				accessToken: ACCESS_TOKEN,
				paths: { devicePath: DEVICE_PATH },
				credentialStore: { clear: vi.fn() }
			},
			{
				loadDevice: vi.fn(async () => {
					throw missing;
				}),
				revoke: vi.fn(),
				removeMetadata: vi.fn()
			}
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(WorkerUnpairError);
		expect(error.code).toBe('worker_device_missing');
		expect(String(error)).not.toContain('/private/device.json');
	});
});

describe('runUnpairCli', () => {
	it('reads the browser token outside argv and prints only the safe revoke receipt', async () => {
		const stdout = sink();
		const stderr = sink();
		const unpairLocal = vi.fn(async ({ accessToken }) => {
			expect(accessToken).toBe(ACCESS_TOKEN);
			return revoked();
		});

		const exitCode = await runUnpairCli([], {
			input: {} as NodeJS.ReadableStream,
			stdout,
			stderr,
			readToken: vi.fn(async () => ACCESS_TOKEN),
			unpairLocal
		});

		expect(exitCode).toBe(0);
		expect(stdout.read()).toContain('"status":"revoked"');
		expect(stdout.read()).not.toContain(ACCESS_TOKEN);
		expect(stderr.read()).toBe('');
	});

	it('rejects argv before asking for a browser token', async () => {
		const readToken = vi.fn();
		const stderr = sink();
		const exitCode = await runUnpairCli([ACCESS_TOKEN], {
			input: {} as NodeJS.ReadableStream,
			stdout: sink(),
			stderr,
			readToken,
			unpairLocal: vi.fn()
		});

		expect(exitCode).toBe(2);
		expect(readToken).not.toHaveBeenCalled();
		expect(stderr.read()).not.toContain(ACCESS_TOKEN);
	});

	it('sanitizes unpair failures before writing stderr', async () => {
		const stdout = sink();
		const stderr = sink();
		const error = Object.assign(new Error(`token ${ACCESS_TOKEN}`), {
			code: 'worker_unpair_local_cleanup_failed'
		});

		const exitCode = await runUnpairCli([], {
			input: {} as NodeJS.ReadableStream,
			stdout,
			stderr,
			readToken: vi.fn(async () => ACCESS_TOKEN),
			unpairLocal: vi.fn(async () => {
				throw error;
			})
		});

		expect(exitCode).toBe(1);
		expect(stdout.read()).toBe('');
		expect(stderr.read()).toContain('worker_unpair_local_cleanup_failed');
		expect(stderr.read()).not.toContain(ACCESS_TOKEN);
	});
});
