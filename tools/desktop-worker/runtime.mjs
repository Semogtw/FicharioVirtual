import { DesktopWorkerClient } from './client.mjs';
import { loadWorkerConfig } from './config.mjs';
import { loadDeviceMetadata } from './device.mjs';
import { SecretServiceCredentialStore } from './keyring.mjs';
import {
	ensurePrivateFile,
	ensureWorkerDirectories,
	resolveWorkerPaths
} from './paths.mjs';
import { ResultSpool } from './spool.mjs';

export class WorkerRuntimeError extends Error {
	constructor(code) {
		super(`Desktop worker runtime failed (${code})`);
		this.name = 'WorkerRuntimeError';
		this.code = code;
	}
}

export async function createWorkerRuntime(
	{ engine, paths = resolveWorkerPaths(), credentialStore = new SecretServiceCredentialStore() },
	{
		signal,
		clientFactory = (options) => new DesktopWorkerClient(options),
		spoolFactory = (path) => new ResultSpool(path)
	} = {}
) {
	if (!engine || typeof engine.process !== 'function') {
		throw new TypeError('Invalid desktop worker OCR engine');
	}
	if (!credentialStore || typeof credentialStore.load !== 'function') {
		throw new TypeError('Invalid desktop worker credential store');
	}
	if (typeof clientFactory !== 'function' || typeof spoolFactory !== 'function') {
		throw new TypeError('Invalid desktop worker runtime factory');
	}

	await ensureWorkerDirectories(paths);
	const [config, device] = await Promise.all([
		loadWorkerConfig(paths.configPath),
		loadDeviceMetadata(paths.devicePath)
	]);
	const credential = await credentialStore.load(device.deviceId, { signal });
	if (credential === null) throw new WorkerRuntimeError('worker_credential_missing');

	await ensurePrivateFile(paths.databasePath);
	let spool;
	try {
		const client = clientFactory({ endpoint: device.workerEndpoint, credential });
		spool = spoolFactory(paths.databasePath);
		const context = Object.freeze({
			client,
			spool,
			engine,
			downloadsDir: paths.downloadsDir
		});
		let closed = false;
		return Object.freeze({
			config,
			device,
			context,
			close() {
				if (closed) return;
				closed = true;
				spool.close();
			}
		});
	} catch (error) {
		spool?.close?.();
		throw error;
	}
}
