import { describe, expect, it, vi } from 'vitest';
import {
	forgetLocalDevice,
	runForgetCli,
	WorkerForgetError
} from '../../../tools/desktop-worker/forget-command.mjs';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';

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

function device() {
	return {
		schemaVersion: 1,
		deviceId: DEVICE_ID,
		label: 'Desktop principal',
		workerEndpoint: 'https://example.supabase.co/functions/v1/desktop-ocr-worker',
		createdAt: '2026-08-10T04:45:00.000Z'
	};
}

describe('forgetLocalDevice', () => {
	it('clears the keyring before removing local metadata and returns no credential or remote claim', async () => {
		const order: string[] = [];
		const credentialStore = {
			clear: vi.fn(async (deviceId: string) => {
				expect(deviceId).toBe(DEVICE_ID);
				order.push('keyring');
				return true;
			})
		};
		const removeMetadata = vi.fn(async () => {
			order.push('metadata');
		});

		await expect(
			forgetLocalDevice(
				{
					paths: { devicePath: '/tmp/device.json' } as never,
					credentialStore
				},
				{ loadDevice: vi.fn(async () => device()), removeMetadata }
			)
		).resolves.toEqual({ label: 'Desktop principal', status: 'forgotten' });
		expect(order).toEqual(['keyring', 'metadata']);
		expect(removeMetadata).toHaveBeenCalledWith('/tmp/device.json');
	});

	it('keeps metadata when keyring cleanup fails so the local device identity is recoverable', async () => {
		const removeMetadata = vi.fn();
		const error = await forgetLocalDevice(
			{
				paths: { devicePath: '/tmp/device.json' } as never,
				credentialStore: {
					clear: vi.fn(async () => {
						throw new Error('private keyring failure');
					})
				}
			},
			{ loadDevice: vi.fn(async () => device()), removeMetadata }
		).catch((caught) => caught);
		expect(error).toBeInstanceOf(WorkerForgetError);
		expect(error.code).toBe('worker_forget_keyring_cleanup_failed');
		expect(removeMetadata).not.toHaveBeenCalled();
	});

	it('reports a safe retryable state when metadata removal fails after the keyring is cleared', async () => {
		const error = await forgetLocalDevice(
			{
				paths: { devicePath: '/tmp/device.json' } as never,
				credentialStore: { clear: vi.fn(async () => true) }
			},
			{
				loadDevice: vi.fn(async () => device()),
				removeMetadata: vi.fn(async () => {
					throw new Error('private filesystem failure');
				})
			}
		).catch((caught) => caught);
		expect(error).toBeInstanceOf(WorkerForgetError);
		expect(error.code).toBe('worker_forget_metadata_cleanup_failed');
	});
});

describe('runForgetCli', () => {
	it('requires explicit acknowledgement that remote revocation already happened', async () => {
		const forgetLocal = vi.fn();
		const stderr = sink();
		const exitCode = await runForgetCli([], {
			stdout: sink(),
			stderr,
			forgetLocal
		});
		expect(exitCode).toBe(2);
		expect(forgetLocal).not.toHaveBeenCalled();
		expect(stderr.read()).toContain('--after-web-revoke');
	});

	it('prints only a bounded local-cleanup receipt after explicit confirmation', async () => {
		const stdout = sink();
		const stderr = sink();
		const exitCode = await runForgetCli(['--after-web-revoke'], {
			stdout,
			stderr,
			forgetLocal: vi.fn(async () => ({ label: 'Desktop principal', status: 'forgotten' }))
		});
		expect(exitCode).toBe(0);
		expect(stdout.read()).toContain('"status":"forgotten"');
		expect(stdout.read()).not.toContain(DEVICE_ID);
		expect(stderr.read()).toBe('');
	});

	it('sanitizes internal cleanup failures', async () => {
		const stdout = sink();
		const stderr = sink();
		const error = Object.assign(new Error(`private ${DEVICE_ID}`), {
			code: 'worker_forget_keyring_cleanup_failed'
		});
		const exitCode = await runForgetCli(['--after-web-revoke'], {
			stdout,
			stderr,
			forgetLocal: vi.fn(async () => {
				throw error;
			})
		});
		expect(exitCode).toBe(1);
		expect(stdout.read()).toBe('');
		expect(stderr.read()).toContain('worker_forget_keyring_cleanup_failed');
		expect(stderr.read()).not.toContain(DEVICE_ID);
	});
});
