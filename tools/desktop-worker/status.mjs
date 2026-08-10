import { access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { loadWorkerConfig } from './config.mjs';
import { loadDeviceMetadata } from './device.mjs';
import { SecretServiceCredentialStore } from './keyring.mjs';
import { loadModelLock, modelLockPath } from './model-lock.mjs';
import { resolveWorkerPaths } from './paths.mjs';

const SAFE_CODE = /^[a-z0-9_]{3,96}$/;

async function inspectFile(loader, path) {
	try {
		return Object.freeze({ state: 'ready', value: await loader(path) });
	} catch (error) {
		if (error?.code === 'ENOENT') return Object.freeze({ state: 'missing', value: null });
		return Object.freeze({ state: 'invalid', value: null });
	}
}

async function inspectCredential(credentialStore, device) {
	if (!device || typeof device.deviceId !== 'string') {
		return Object.freeze({ state: 'not_applicable' });
	}
	try {
		const credential = await credentialStore.load(device.deviceId);
		return Object.freeze({ state: credential === null ? 'missing' : 'ready' });
	} catch {
		return Object.freeze({ state: 'unavailable' });
	}
}

async function inspectSpool(path, databaseFactory) {
	try {
		await access(path);
	} catch (error) {
		if (error?.code === 'ENOENT') {
			return Object.freeze({
				state: 'missing',
				pending: 0,
				accepted: 0,
				rejected: 0,
				rejectionReasons: Object.freeze({})
			});
		}
		return Object.freeze({ state: 'unavailable' });
	}

	let database;
	try {
		database = databaseFactory(path);
		const spoolRows = database
			.prepare('SELECT state, COUNT(*) AS count FROM result_spool GROUP BY state')
			.all();
		const rejectedRows = database
			.prepare('SELECT reason_code, COUNT(*) AS count FROM result_dead_letter GROUP BY reason_code')
			.all();
		let pending = 0;
		let accepted = 0;
		for (const row of spoolRows) {
			if (row.state === 'pending') pending = Number(row.count);
			if (row.state === 'accepted') accepted = Number(row.count);
		}
		const rejectionReasons = {};
		let rejected = 0;
		for (const row of rejectedRows) {
			const count = Number(row.count);
			rejected += count;
			const code =
				typeof row.reason_code === 'string' && SAFE_CODE.test(row.reason_code)
					? row.reason_code
					: 'invalid_reason_code';
			rejectionReasons[code] = (rejectionReasons[code] ?? 0) + count;
		}
		return Object.freeze({
			state: 'ready',
			pending,
			accepted,
			rejected,
			rejectionReasons: Object.freeze(rejectionReasons)
		});
	} catch {
		return Object.freeze({ state: 'unavailable' });
	} finally {
		database?.close();
	}
}

export async function inspectWorkerStatus(
	{ paths = resolveWorkerPaths(), credentialStore = new SecretServiceCredentialStore() } = {},
	{
		loadConfig = loadWorkerConfig,
		loadDevice = loadDeviceMetadata,
		loadLock = loadModelLock,
		databaseFactory = (path) => new DatabaseSync(path)
	} = {}
) {
	if (!credentialStore || typeof credentialStore.load !== 'function') {
		throw new TypeError('Invalid desktop worker credential store');
	}
	if (
		typeof loadConfig !== 'function' ||
		typeof loadDevice !== 'function' ||
		typeof loadLock !== 'function' ||
		typeof databaseFactory !== 'function'
	) {
		throw new TypeError('Invalid desktop worker status dependency');
	}

	const [config, device, model, spool] = await Promise.all([
		inspectFile(loadConfig, paths.configPath),
		inspectFile(loadDevice, paths.devicePath),
		inspectFile(loadLock, modelLockPath(paths)),
		inspectSpool(paths.databasePath, databaseFactory)
	]);
	const credential = await inspectCredential(credentialStore, device.value);
	const readyToRun =
		config.state === 'ready' &&
		device.state === 'ready' &&
		model.state === 'ready' &&
		credential.state === 'ready';

	return Object.freeze({
		readyToRun,
		config: Object.freeze({
			state: config.state,
			appOrigin: config.value?.appOrigin ?? null
		}),
		device: Object.freeze({
			state: device.state,
			label: device.value?.label ?? null,
			workerEndpoint: device.value?.workerEndpoint ?? null
		}),
		model: Object.freeze({
			state: model.state,
			backend: model.value?.backend ?? null,
			model: model.value?.model ?? null,
			digest: model.value?.digest ?? null
		}),
		credential,
		spool
	});
}
