import { randomUUID } from 'node:crypto';
import { chmod, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { OllamaOcrEngine } from './ollama-engine.mjs';

export const MODEL_LOCK_SCHEMA_VERSION = 1;

const SHA256 = /^[0-9a-f]{64}$/;
const MODEL = /^[A-Za-z0-9._:/-]+$/;
const MODEL_LOCK_KEYS = Object.freeze(['schemaVersion', 'backend', 'model', 'digest']);
const MAX_MODEL_LOCK_BYTES = 8 * 1024;

function exactKeys(record, expected) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function modelLockPath(paths) {
	if (!paths || typeof paths.configDir !== 'string' || paths.configDir.length === 0) {
		throw new TypeError('Invalid desktop worker paths for model lock');
	}
	return join(paths.configDir, 'model.json');
}

export function parseModelLock(value) {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!exactKeys(value, MODEL_LOCK_KEYS)
	) {
		throw new TypeError('Invalid desktop worker model lock shape');
	}
	if (value.schemaVersion !== MODEL_LOCK_SCHEMA_VERSION) {
		throw new TypeError('Unsupported desktop worker model lock schemaVersion');
	}
	if (value.backend !== 'ollama') {
		throw new TypeError('Unsupported desktop worker model lock backend');
	}
	if (
		typeof value.model !== 'string' ||
		value.model.length < 1 ||
		value.model.length > 128 ||
		!MODEL.test(value.model)
	) {
		throw new TypeError('Invalid desktop worker model id');
	}
	if (typeof value.digest !== 'string' || !SHA256.test(value.digest)) {
		throw new TypeError('Invalid desktop worker model digest');
	}
	return Object.freeze({
		schemaVersion: MODEL_LOCK_SCHEMA_VERSION,
		backend: 'ollama',
		model: value.model,
		digest: value.digest
	});
}

export async function loadModelLock(path) {
	const text = await readFile(path, 'utf8');
	if (Buffer.byteLength(text, 'utf8') > MAX_MODEL_LOCK_BYTES) {
		throw new TypeError('Desktop worker model lock is too large');
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new TypeError('Desktop worker model lock is not valid JSON');
	}
	return parseModelLock(parsed);
}

export async function saveModelLock(path, value) {
	const lock = parseModelLock(value);
	const temporaryPath = join(dirname(path), `.model.${randomUUID()}.tmp`);
	let handle;
	try {
		handle = await open(temporaryPath, 'wx', 0o600);
		await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporaryPath, path);
		await chmod(path, 0o600);
		return lock;
	} catch (error) {
		if (handle) await handle.close().catch(() => undefined);
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

export async function createLockedOcrEngine(
	paths,
	{ fetchImpl = fetch, baseUrl = 'http://127.0.0.1:11434/' } = {}
) {
	const lock = await loadModelLock(modelLockPath(paths));
	if (lock.backend !== 'ollama') {
		throw new TypeError('Unsupported desktop worker model backend');
	}
	return new OllamaOcrEngine({
		model: lock.model,
		expectedDigest: lock.digest,
		baseUrl,
		fetchImpl
	});
}
