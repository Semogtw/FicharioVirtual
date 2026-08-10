import process from 'node:process';
import { rm } from 'node:fs/promises';
import { loadDeviceMetadata } from './device.mjs';
import { SecretServiceCredentialStore } from './keyring.mjs';
import { resolveWorkerPaths } from './paths.mjs';

const SAFE_CODE = /^[a-z0-9_]{3,96}$/;
const CONFIRMATION_FLAG = '--after-web-revoke';

function safeErrorCode(error) {
	return typeof error?.code === 'string' && SAFE_CODE.test(error.code)
		? error.code
		: 'worker_forget_cli_failed';
}

export class WorkerForgetError extends Error {
	constructor(code) {
		super(`Desktop worker local cleanup failed (${code})`);
		this.name = 'WorkerForgetError';
		this.code = code;
	}
}

export async function forgetLocalDevice(
	{ paths = resolveWorkerPaths(), credentialStore = new SecretServiceCredentialStore() } = {},
	{ loadDevice = loadDeviceMetadata, removeMetadata = (path) => rm(path, { force: false }) } = {}
) {
	if (!credentialStore || typeof credentialStore.clear !== 'function') {
		throw new TypeError('Invalid desktop worker credential store');
	}
	if (typeof loadDevice !== 'function' || typeof removeMetadata !== 'function') {
		throw new TypeError('Invalid desktop worker local cleanup dependency');
	}

	let device;
	try {
		device = await loadDevice(paths.devicePath);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new WorkerForgetError('worker_device_missing');
		throw error;
	}

	try {
		await credentialStore.clear(device.deviceId);
	} catch {
		throw new WorkerForgetError('worker_forget_keyring_cleanup_failed');
	}

	try {
		await removeMetadata(paths.devicePath);
	} catch {
		throw new WorkerForgetError('worker_forget_metadata_cleanup_failed');
	}

	return Object.freeze({
		label: device.label,
		status: 'forgotten'
	});
}

export async function runForgetCli(
	argv = process.argv.slice(2),
	{ stdout = process.stdout, stderr = process.stderr, forgetLocal = forgetLocalDevice } = {}
) {
	if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== CONFIRMATION_FLAG) {
		stderr.write(
			'Usage: fichario-worker-forget --after-web-revoke\n' +
				'Revoke this computer in the web app before deleting its local credential.\n'
		);
		return 2;
	}
	try {
		const result = await forgetLocal();
		stdout.write(`${JSON.stringify(result)}\n`);
		return 0;
	} catch (error) {
		stderr.write(`${JSON.stringify({ status: 'failed', code: safeErrorCode(error) })}\n`);
		return 1;
	}
}
