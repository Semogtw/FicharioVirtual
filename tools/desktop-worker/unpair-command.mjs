import { rm } from 'node:fs/promises';
import { loadDeviceMetadata } from './device.mjs';
import { SecretServiceCredentialStore } from './keyring.mjs';
import { readBrowserAccessToken } from './pair-command.mjs';
import { revokeDesktopWorkerPairing } from './pairing.mjs';
import { resolveWorkerPaths } from './paths.mjs';

const SAFE_CODE = /^[a-z0-9_]{3,96}$/;

function safeErrorCode(error) {
	return typeof error?.code === 'string' && SAFE_CODE.test(error.code)
		? error.code
		: 'worker_unpair_cli_failed';
}

export class WorkerUnpairError extends Error {
	constructor(code) {
		super(`Desktop worker unpair failed (${code})`);
		this.name = 'WorkerUnpairError';
		this.code = code;
	}
}

export async function unpairFromLocalState(
	{
		accessToken,
		paths = resolveWorkerPaths(),
		credentialStore = new SecretServiceCredentialStore()
	},
	{
		loadDevice = loadDeviceMetadata,
		revoke = revokeDesktopWorkerPairing,
		removeMetadata = (path) => rm(path, { force: false })
	} = {}
) {
	if (!credentialStore || typeof credentialStore.clear !== 'function') {
		throw new TypeError('Invalid desktop worker credential store');
	}
	if (
		typeof loadDevice !== 'function' ||
		typeof revoke !== 'function' ||
		typeof removeMetadata !== 'function'
	) {
		throw new TypeError('Invalid desktop worker unpair dependency');
	}

	let device;
	try {
		device = await loadDevice(paths.devicePath);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new WorkerUnpairError('worker_device_missing');
		throw error;
	}

	const revoked = await revoke({
		workerEndpoint: device.workerEndpoint,
		deviceId: device.deviceId,
		accessToken
	});

	try {
		await credentialStore.clear(device.deviceId);
		await removeMetadata(paths.devicePath);
	} catch {
		// Keep device.json if cleanup is incomplete so the idempotent revoke can be retried.
		throw new WorkerUnpairError('worker_unpair_local_cleanup_failed');
	}

	return Object.freeze({
		deviceId: device.deviceId,
		label: device.label,
		status: revoked.status,
		revokedAt: revoked.revokedAt,
		requeuedJobs: revoked.requeuedJobs
	});
}

export async function runUnpairCli(
	argv = process.argv.slice(2),
	{
		input = process.stdin,
		stdout = process.stdout,
		stderr = process.stderr,
		readToken = readBrowserAccessToken,
		unpairLocal = unpairFromLocalState
	} = {}
) {
	if (!Array.isArray(argv) || argv.length !== 0) {
		stderr.write('Usage: fichario-worker-unpair\n');
		return 2;
	}
	try {
		const accessToken = await readToken(input, stderr);
		const result = await unpairLocal({ accessToken });
		stdout.write(`${JSON.stringify(result)}\n`);
		return 0;
	} catch (error) {
		if (error?.name === 'AbortError') return 130;
		stderr.write(`${JSON.stringify({ status: 'failed', code: safeErrorCode(error) })}\n`);
		return 1;
	}
}
