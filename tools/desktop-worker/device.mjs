import { randomUUID } from 'node:crypto';
import { chmod, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEVICE_SCHEMA_VERSION = 1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_KEYS = Object.freeze([
	'schemaVersion',
	'deviceId',
	'label',
	'workerEndpoint',
	'createdAt'
]);
const MAX_DEVICE_FILE_BYTES = 16 * 1024;

function exactKeys(record, expected) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseLabel(value) {
	if (
		typeof value !== 'string' ||
		value !== value.trim() ||
		value.length < 1 ||
		value.length > 80 ||
		// eslint-disable-next-line no-control-regex -- device labels must be safe for logs/UI
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		throw new TypeError('Invalid desktop worker device label');
	}
	return value;
}

export function parseWorkerEndpoint(value) {
	if (typeof value !== 'string' || value.length > 2048) {
		throw new TypeError('Invalid desktop worker endpoint');
	}
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError('Invalid desktop worker endpoint');
	}
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/functions/v1/desktop-ocr-worker'
	) {
		throw new TypeError('Invalid desktop worker endpoint');
	}
	return url.toString();
}

export function parseDeviceMetadata(value) {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!exactKeys(value, DEVICE_KEYS)
	) {
		throw new TypeError('Invalid desktop worker device metadata shape');
	}
	if (value.schemaVersion !== DEVICE_SCHEMA_VERSION) {
		throw new TypeError('Unsupported desktop worker device schemaVersion');
	}
	if (typeof value.deviceId !== 'string' || !UUID.test(value.deviceId)) {
		throw new TypeError('Invalid desktop worker device id');
	}
	if (
		typeof value.createdAt !== 'string' ||
		value.createdAt.length > 64 ||
		!Number.isFinite(Date.parse(value.createdAt))
	) {
		throw new TypeError('Invalid desktop worker device creation timestamp');
	}
	return Object.freeze({
		schemaVersion: DEVICE_SCHEMA_VERSION,
		deviceId: value.deviceId,
		label: parseLabel(value.label),
		workerEndpoint: parseWorkerEndpoint(value.workerEndpoint),
		createdAt: value.createdAt
	});
}

export async function loadDeviceMetadata(path) {
	const text = await readFile(path, { encoding: 'utf8' });
	if (Buffer.byteLength(text, 'utf8') > MAX_DEVICE_FILE_BYTES) {
		throw new TypeError('Desktop worker device metadata is too large');
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new TypeError('Desktop worker device metadata is not valid JSON');
	}
	return parseDeviceMetadata(parsed);
}

export async function saveDeviceMetadata(path, value) {
	const metadata = parseDeviceMetadata(value);
	const directory = dirname(path);
	const temporaryPath = join(directory, `.device.${randomUUID()}.tmp`);
	const body = `${JSON.stringify(metadata, null, 2)}\n`;
	let handle;
	try {
		handle = await open(temporaryPath, 'wx', 0o600);
		await handle.writeFile(body, 'utf8');
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporaryPath, path);
		await chmod(path, 0o600);
		return metadata;
	} catch (error) {
		if (handle) await handle.close().catch(() => undefined);
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}
