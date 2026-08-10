import { open } from 'node:fs/promises';
import { parseWorkerConfig } from './config.mjs';
import { ensureWorkerDirectories, resolveWorkerPaths } from './paths.mjs';

export class ConfigSetupError extends Error {
	constructor(code) {
		super(`Desktop worker config setup failed (${code})`);
		this.name = 'ConfigSetupError';
		this.code = code;
	}
}

export function defaultWorkerConfig(appOrigin) {
	return parseWorkerConfig({
		schemaVersion: 1,
		appOrigin,
		backendPreference: ['cpu'],
		maxConcurrency: 1,
		pollIntervalSeconds: 30,
		idlePollIntervalSeconds: 300,
		modelChannel: 'stable',
		keepCompletedSpoolHours: 24
	});
}

export async function initializeWorkerConfig(
	appOrigin,
	{ paths = resolveWorkerPaths(), now = () => new Date() } = {}
) {
	if (typeof now !== 'function') throw new TypeError('Invalid desktop worker config clock');
	const config = defaultWorkerConfig(appOrigin);
	await ensureWorkerDirectories(paths);

	let handle;
	try {
		handle = await open(paths.configPath, 'wx', 0o600);
		await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
		await handle.sync();
		await handle.close();
		handle = undefined;
	} catch (error) {
		await handle?.close().catch(() => undefined);
		if (error?.code === 'EEXIST') throw new ConfigSetupError('worker_config_exists');
		throw error;
	}

	return Object.freeze({
		config,
		createdAt: now().toISOString()
	});
}
