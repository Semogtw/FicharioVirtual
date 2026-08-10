import { readFile } from 'node:fs/promises';

export const WORKER_CONFIG_SCHEMA_VERSION = 1;
export const WORKER_BACKENDS = Object.freeze(['vulkan', 'cpu', 'rocm-experimental']);

const CONFIG_KEYS = Object.freeze([
	'schemaVersion',
	'appOrigin',
	'backendPreference',
	'maxConcurrency',
	'pollIntervalSeconds',
	'idlePollIntervalSeconds',
	'modelChannel',
	'keepCompletedSpoolHours'
]);

function exactKeys(value, expected) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function integerInRange(value, minimum, maximum, label) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new TypeError(`Invalid desktop worker ${label}`);
	}
	return value;
}

function parseAppOrigin(value) {
	if (typeof value !== 'string' || value.length > 2048) {
		throw new TypeError('Invalid desktop worker appOrigin');
	}
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError('Invalid desktop worker appOrigin');
	}
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/'
	) {
		throw new TypeError('Invalid desktop worker appOrigin');
	}
	return url.origin;
}

function parseBackends(value) {
	if (!Array.isArray(value) || value.length < 1 || value.length > WORKER_BACKENDS.length) {
		throw new TypeError('Invalid desktop worker backendPreference');
	}
	const seen = new Set();
	const result = [];
	for (const backend of value) {
		if (typeof backend !== 'string' || !WORKER_BACKENDS.includes(backend) || seen.has(backend)) {
			throw new TypeError('Invalid desktop worker backendPreference');
		}
		seen.add(backend);
		result.push(backend);
	}
	if (!seen.has('cpu')) {
		throw new TypeError('Desktop worker backendPreference must include cpu');
	}
	return Object.freeze(result);
}

export function parseWorkerConfig(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, CONFIG_KEYS)) {
		throw new TypeError('Invalid desktop worker config shape');
	}
	if (value.schemaVersion !== WORKER_CONFIG_SCHEMA_VERSION) {
		throw new TypeError('Unsupported desktop worker config schemaVersion');
	}
	if (value.modelChannel !== 'stable') {
		throw new TypeError('Unsupported desktop worker modelChannel');
	}

	return Object.freeze({
		schemaVersion: WORKER_CONFIG_SCHEMA_VERSION,
		appOrigin: parseAppOrigin(value.appOrigin),
		backendPreference: parseBackends(value.backendPreference),
		maxConcurrency: integerInRange(value.maxConcurrency, 1, 1, 'maxConcurrency'),
		pollIntervalSeconds: integerInRange(value.pollIntervalSeconds, 10, 300, 'pollIntervalSeconds'),
		idlePollIntervalSeconds: integerInRange(
			value.idlePollIntervalSeconds,
			30,
			3600,
			'idlePollIntervalSeconds'
		),
		modelChannel: 'stable',
		keepCompletedSpoolHours: integerInRange(
			value.keepCompletedSpoolHours,
			0,
			168,
			'keepCompletedSpoolHours'
		)
	});
}

export async function loadWorkerConfig(path) {
	const text = await readFile(path, { encoding: 'utf8' });
	if (text.length > 64 * 1024) throw new TypeError('Desktop worker config is too large');
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new TypeError('Desktop worker config is not valid JSON');
	}
	return parseWorkerConfig(parsed);
}
