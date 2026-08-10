import { parseWorkerEndpoint, saveDeviceMetadata } from './device.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SAFE_CODE = /^[a-z0-9_]{3,96}$/;
const MAX_ACCESS_TOKEN_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_CAPABILITIES_BYTES = 12 * 1024;

function requireLabel(value) {
	if (
		typeof value !== 'string' ||
		value !== value.trim() ||
		value.length < 1 ||
		value.length > 80 ||
		// eslint-disable-next-line no-control-regex -- labels are persisted and surfaced in UI
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		throw new TypeError('Invalid desktop worker pairing label');
	}
	return value;
}

function requireAccessToken(value) {
	if (
		typeof value !== 'string' ||
		Buffer.byteLength(value, 'utf8') > MAX_ACCESS_TOKEN_BYTES ||
		!JWT.test(value)
	) {
		throw new TypeError('Invalid desktop worker browser access token');
	}
	return value;
}

function requireCapabilities(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid desktop worker capabilities');
	}
	let json;
	try {
		json = JSON.stringify(value);
	} catch {
		throw new TypeError('Invalid desktop worker capabilities');
	}
	if (Buffer.byteLength(json, 'utf8') > MAX_CAPABILITIES_BYTES) {
		throw new TypeError('Desktop worker capabilities are too large');
	}
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new TypeError('Invalid desktop worker capabilities');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new TypeError('Invalid desktop worker capabilities');
	}
	return Object.freeze(parsed);
}

function pairEndpoint(workerEndpoint) {
	const worker = new URL(parseWorkerEndpoint(workerEndpoint));
	return new URL('/functions/v1/desktop-ocr-pair', worker.origin).toString();
}

async function readBoundedJson(response) {
	if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
		throw new DesktopPairingError('desktop_ocr_pair_response_invalid', response.status);
	}
	const declared = response.headers.get('content-length');
	if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
		throw new DesktopPairingError('desktop_ocr_pair_response_too_large', response.status);
	}
	if (!response.body) {
		throw new DesktopPairingError('desktop_ocr_pair_response_invalid', response.status);
	}
	const chunks = [];
	let total = 0;
	for await (const chunk of response.body) {
		const bytes = Buffer.from(chunk);
		total += bytes.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			throw new DesktopPairingError('desktop_ocr_pair_response_too_large', response.status);
		}
		chunks.push(bytes);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new DesktopPairingError('desktop_ocr_pair_response_invalid', response.status);
	}
}

function parsePairingReceipt(value, expectedLabel, expectedCapabilities) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new DesktopPairingError('desktop_ocr_pair_response_invalid', 201);
	}
	const keys = Object.keys(value).sort();
	const expectedKeys = ['capabilities', 'createdAt', 'credential', 'deviceId', 'label', 'status'];
	if (keys.length !== expectedKeys.length || !keys.every((key, index) => key === expectedKeys[index])) {
		throw new DesktopPairingError('desktop_ocr_pair_response_invalid', 201);
	}
	if (
		typeof value.deviceId !== 'string' ||
		!UUID.test(value.deviceId) ||
		value.label !== expectedLabel ||
		value.status !== 'active' ||
		typeof value.createdAt !== 'string' ||
		!Number.isFinite(Date.parse(value.createdAt)) ||
		typeof value.credential !== 'string' ||
		!CREDENTIAL.test(value.credential) ||
		!value.capabilities ||
		typeof value.capabilities !== 'object' ||
		Array.isArray(value.capabilities) ||
		JSON.stringify(value.capabilities) !== JSON.stringify(expectedCapabilities)
	) {
		throw new DesktopPairingError('desktop_ocr_pair_response_invalid', 201);
	}
	return Object.freeze({
		deviceId: value.deviceId,
		label: value.label,
		createdAt: value.createdAt,
		credential: value.credential
	});
}

export class DesktopPairingError extends Error {
	constructor(code, httpStatus = 0) {
		super(`Desktop worker pairing failed (${code})`);
		this.name = 'DesktopPairingError';
		this.code = code;
		this.httpStatus = httpStatus;
	}
}

export async function pairDesktopWorker(
	{
		workerEndpoint,
		label,
		capabilities,
		accessToken,
		devicePath,
		credentialStore
	},
	{ fetchImpl = fetch, saveMetadata = saveDeviceMetadata, signal } = {}
) {
	const endpoint = pairEndpoint(workerEndpoint);
	const safeLabel = requireLabel(label);
	const safeCapabilities = requireCapabilities(capabilities);
	const sessionToken = requireAccessToken(accessToken);
	if (typeof devicePath !== 'string' || devicePath.length === 0) {
		throw new TypeError('Invalid desktop worker device metadata path');
	}
	if (
		!credentialStore ||
		typeof credentialStore.store !== 'function' ||
		typeof credentialStore.clear !== 'function'
	) {
		throw new TypeError('Invalid desktop worker credential store');
	}
	if (typeof fetchImpl !== 'function' || typeof saveMetadata !== 'function') {
		throw new TypeError('Invalid desktop worker pairing dependency');
	}

	let response;
	try {
		response = await fetchImpl(endpoint, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${sessionToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ label: safeLabel, capabilities: safeCapabilities }),
			redirect: 'error',
			signal
		});
	} catch (error) {
		if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
		throw new DesktopPairingError('desktop_ocr_pair_network_failed');
	}

	const body = await readBoundedJson(response);
	if (response.status !== 201) {
		const code =
			body &&
			typeof body === 'object' &&
			!Array.isArray(body) &&
			typeof body.code === 'string' &&
			SAFE_CODE.test(body.code)
				? body.code
				: 'desktop_ocr_pair_failed';
		throw new DesktopPairingError(code, response.status);
	}
	const receipt = parsePairingReceipt(body, safeLabel, safeCapabilities);

	await credentialStore.store(receipt.deviceId, receipt.credential, { signal });
	try {
		await saveMetadata(devicePath, {
			schemaVersion: 1,
			deviceId: receipt.deviceId,
			label: receipt.label,
			workerEndpoint: parseWorkerEndpoint(workerEndpoint),
			createdAt: receipt.createdAt
		});
	} catch (error) {
		await credentialStore.clear(receipt.deviceId, { signal }).catch(() => undefined);
		throw error;
	}

	return Object.freeze({
		deviceId: receipt.deviceId,
		label: receipt.label,
		status: 'active',
		createdAt: receipt.createdAt
	});
}
