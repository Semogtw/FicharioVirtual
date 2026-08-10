import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
	SecretServiceCredentialStore,
	SecretServiceError,
	runSecretTool
} from '../../../tools/desktop-worker/keyring.mjs';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL = 'A'.repeat(43);

function fakeChild({ stdout = '', code = 0 }: { stdout?: string; code?: number } = {}) {
	const child = new EventEmitter() as EventEmitter & {
		stdin: PassThrough;
		stdout: PassThrough;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.kill = vi.fn();
	queueMicrotask(() => {
		if (stdout) child.stdout.write(stdout);
		child.stdout.end();
		child.emit('close', code, null);
	});
	return child;
}

describe('SecretServiceCredentialStore', () => {
	it('passes the device credential only as stdin input, never in argv', async () => {
		const runTool = vi.fn(async () => '');
		const store = new SecretServiceCredentialStore({ runTool });

		await expect(store.store(DEVICE_ID, CREDENTIAL)).resolves.toBe(true);

		const [args, options] = runTool.mock.calls[0];
		expect(args).toEqual([
			'store',
			'--label=Fichario OCR Worker',
			'application',
			'fichario-worker',
			'device-id',
			DEVICE_ID
		]);
		expect(JSON.stringify(args)).not.toContain(CREDENTIAL);
		expect(options.input).toBe(CREDENTIAL);
		expect(options.command).toBe('/usr/bin/secret-tool');
	});

	it('loads only an exact worker credential and strips one CLI newline', async () => {
		const store = new SecretServiceCredentialStore({
			runTool: vi.fn(async () => `${CREDENTIAL}\n`)
		});
		await expect(store.load(DEVICE_ID)).resolves.toBe(CREDENTIAL);
	});

	it('fails closed when Secret Service returns malformed secret material', async () => {
		const store = new SecretServiceCredentialStore({
			runTool: vi.fn(async () => 'not-a-worker-credential\n')
		});
		await expect(store.load(DEVICE_ID)).rejects.toMatchObject({
			code: 'secret_service_credential_invalid'
		});
	});

	it('treats a missing lookup or clear entry as absence without exposing tool output', async () => {
		const runTool = vi.fn(async () => {
			throw new SecretServiceError('secret_service_rejected');
		});
		const store = new SecretServiceCredentialStore({ runTool });
		await expect(store.load(DEVICE_ID)).resolves.toBeNull();
		await expect(store.clear(DEVICE_ID)).resolves.toBe(false);
	});

	it('rejects invalid device ids and credentials before invoking Secret Service', async () => {
		const runTool = vi.fn();
		const store = new SecretServiceCredentialStore({ runTool });
		await expect(store.store('../device', CREDENTIAL)).rejects.toThrow('device id');
		await expect(store.store(DEVICE_ID, 'short')).rejects.toThrow('credential');
		expect(runTool).not.toHaveBeenCalled();
	});
});

describe('runSecretTool', () => {
	it('spawns an absolute binary without a shell and writes secret input only to stdin', async () => {
		let capturedInput = '';
		const spawnImpl = vi.fn((_command, _args, options) => {
			const child = fakeChild({ stdout: 'ok\n' });
			child.stdin.on('data', (chunk) => {
				capturedInput += String(chunk);
			});
			expect(options.shell).toBe(false);
			expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore']);
			return child;
		});

		await expect(
			runSecretTool(['store', 'application', 'fichario-worker'], {
				input: CREDENTIAL,
				spawnImpl
			})
		).resolves.toBe('ok\n');

		const [command, args] = spawnImpl.mock.calls[0];
		expect(command).toBe('/usr/bin/secret-tool');
		expect(JSON.stringify(args)).not.toContain(CREDENTIAL);
		expect(capturedInput).toBe(CREDENTIAL);
	});

	it('maps nonzero exits to a safe error code without stderr capture', async () => {
		const spawnImpl = vi.fn(() => fakeChild({ code: 1 }));
		const error = await runSecretTool(['lookup', 'application', 'fichario-worker'], {
			spawnImpl
		}).catch((caught) => caught);
		expect(error).toBeInstanceOf(SecretServiceError);
		expect(error.code).toBe('secret_service_rejected');
		expect(String(error)).not.toContain(CREDENTIAL);
	});

	it('kills and rejects excessive stdout instead of buffering unbounded tool output', async () => {
		let child!: ReturnType<typeof fakeChild>;
		const spawnImpl = vi.fn(() => {
			child = fakeChild({ stdout: 'x'.repeat(1025) });
			return child;
		});
		await expect(runSecretTool(['lookup', 'application', 'fichario-worker'], { spawnImpl })).rejects.toMatchObject({
			code: 'secret_service_response_too_large'
		});
		expect(child.kill).toHaveBeenCalledWith('SIGKILL');
	});
});
