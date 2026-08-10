import { chmod, mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

function absoluteDirectory(value, fallback) {
	const directory = value || fallback;
	if (typeof directory !== 'string' || directory.length === 0) {
		throw new TypeError('Invalid desktop worker XDG directory');
	}
	return resolve(directory);
}

export function resolveWorkerPaths(env = process.env, home = homedir()) {
	const configHome = absoluteDirectory(env.XDG_CONFIG_HOME, join(home, '.config'));
	const cacheHome = absoluteDirectory(env.XDG_CACHE_HOME, join(home, '.cache'));
	const stateHome = absoluteDirectory(env.XDG_STATE_HOME, join(home, '.local', 'state'));

	const configDir = join(configHome, 'fichario-worker');
	const cacheDir = join(cacheHome, 'fichario-worker');
	const stateDir = join(stateHome, 'fichario-worker');
	return Object.freeze({
		configDir,
		cacheDir,
		stateDir,
		modelsDir: join(cacheDir, 'models'),
		downloadsDir: join(cacheDir, 'downloads'),
		spoolDir: join(stateDir, 'spool'),
		configPath: join(configDir, 'config.json'),
		devicePath: join(configDir, 'device.json'),
		databasePath: join(stateDir, 'worker.db')
	});
}

async function ensurePrivateDirectory(path) {
	await mkdir(path, { recursive: true, mode: 0o700 });
	await chmod(path, 0o700);
}

export async function ensureWorkerDirectories(paths) {
	for (const path of [
		paths.configDir,
		paths.cacheDir,
		paths.stateDir,
		paths.modelsDir,
		paths.downloadsDir,
		paths.spoolDir
	]) {
		await ensurePrivateDirectory(path);
	}
}

export async function ensurePrivateFile(path) {
	const handle = await open(path, 'a', 0o600);
	try {
		await handle.chmod(0o600);
	} finally {
		await handle.close();
	}
}
