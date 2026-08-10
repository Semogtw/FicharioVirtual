import { createHash, randomBytes } from 'node:crypto';
import { parseWorkerEndpoint, saveDeviceMetadata } from './device.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;
const PAIRING_CODE = /^[0-9A-Fa-f]{4}(-[0-9A-Fa-f]{4}){3}$/;
const SAFE_CODE = /^[a-z0-9_]{3,96}$/;
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

function requirePairingCode(value) {
	if (typeof value !== 'string' || !PAIRING_CODE.test(value)) {
		throw new TypeError('Invalid desktop worker pairing code');
	}
	return value.toUpperCase();
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
	return Object.freeze(JSON.parse(json));
}

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function pairEndpoint(workerEndpoint) {
	const worker = new URL(parseWorkerEndpoint(workerEndpoint));
	return new URL('/functions/v1/desktop-ocr-pair', worker.origin).toString();
}

function generateCredential(randomBytesImpl) {
	const bytes = Buffer.from(randomBytesImpl(32));
	if (bytes.byteLength !== 32) {
		throw new DesktopPairingCodeError('desktop_ocr_pair_credential_generation_failed');
	}
	const credential = bytes.toString('base64url');
	if (!CREDENTIAL.test(credential)) {
		throw new DesktopPairingCodeError('desktop_ocr_pair_credential_generation_failed');
	}
	const digestHex = createHash('sha256').update(credential, 'utf8').digest('hex');
	return Object.freeze({ credential, digestHex });
}

async function readBoundedJson(response) {
	if (
		response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
		'application/json'
	) {
		throw new DesktopPairingCodeError('desktop_ocr_pair_response_invalid', response.status);
	}
	const declared = response.headers.get('content-length');
	if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
		throw new DesktopPairingCodeError('desktop_ocr_pair_response_too_large', response.status);
	}
	if (!response.body) {
		throw new DesktopPairingCodeError('desktop_ocr_pair_response_invalid', response.status);
	}
	const chunks = [];
	let total = 0;
	for await (const chunk of response.body) {
		const bytes = Buffer.from(chunk);
		total += bytes.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			throw new DesktopPairingCodeError('desktop_ocr_pair_response_too_large', response.status);
		}
		chunks.push(bytes);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new DesktopPairingCodeError('desktop_ocr_pair_response_invalid', response.status);
	}
}

function safeBackendCode(body, fallback) {
	return body &&
		typeof body === 'object' &&
		!Array.isArray(body) &&
		typeof body.code === 'string' &&
		SAFE_CODE.test(body.code)
		? body.code
		: fallback;
}

function parseReceipt(value, expectedLabel, expectedCapabilities) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new DesktopPairingCodeError('desktop_ocr_pair_response_invalid', 201);
	}
	const keys = Object.keys(value).sort();
	const expectedKeys = ['capabilities', 'createdAt', 'deviceId', 'label', 'status'];
	if (
		keys.length !== expectedKeys.length ||
		!keys.every((key, index) => key === expectedKeys[index]) ||
		typeof value.deviceId !== 'string' ||
		!UUID.test(value.deviceId) ||
		value.label !== expectedLabel ||
		value.status !== 'active' ||
		typeof value.createdAt !== 'string' ||
		!Number.isFinite(Date.parse(value.createdAt)) ||
		!value.capabilities ||
		typeof value.capabilities !== 'object' ||
		Array.isArray(value.capabilities) ||
		canonicalJson(value.capabilities) !== canonicalJson(expectedCapabilities)
	) {
		throw new DesktopPairingCodeError('desktop_ocr_pair_response_invalid', 201);
	}
	return Object.freeze({
		deviceId: value.deviceId,
		label: value.label,
		createdAt: value.createdAt
	});
}

export class DesktopPairingCodeError extends Error {
	constructor(code, httpStatus = 0) {
		super(`Desktop worker code pairing failed (${code})`);
		this.name = 'DesktopPairingCodeError';
		this.code = code;
		this.httpStatus = httpStatus;
	}
}

export async function pairDesktopWorkerWithCode(
	{ workerEndpoint, label, capabilities, pairingCode, devicePath, credentialStore },
	{
		fetchImpl = fetch,
		saveMetadata = saveDeviceMetadata,
		randomBytesImpl = randomBytes,
		signal
	} = {}
) {
	const endpoint = pairEndpoint(workerEndpoint);
	const safeLabel = requireLabel(label);
	const safeCapabilities = requireCapabilities(capabilities);
	const safePairingCode = requirePairingCode(pairingCode);
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
	if (
		typeof fetchImpl !== 'function' ||
		typeof saveMetadata !== 'function' ||
		typeof randomBytesImpl !== 'function'
	) {
		throw new TypeError('Invalid desktop worker code pairing dependency');
	}

	const generated = generateCredential(randomBytesImpl);
	let response;
	try {
		response = await fetchImpl(endpoint, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				action: 'redeem',
				pairingCode: safePairingCode,
				label: safeLabel,
				capabilities: safeCapabilities,
				credentialDigest: generated.digestHex
			}),
			redirect: 'error',
			signal
		});
	} catch (error) {
		if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
		throw new DesktopPairingCodeError('desktop_ocr_pair_network_failed');
	}

	const body = await readBoundedJson(response);
	if (response.status !== 201) {
		throw new DesktopPairingCodeError(
			safeBackendCode(body, 'desktop_ocr_pair_failed'),
			response.status
		);
	}
	const receipt = parseReceipt(body, safeLabel, safeCapabilities);

	try {
		await credentialStore.store(receipt.deviceId, generated.credential, { signal });
		await saveMetadata(devicePath, {
			schemaVersion: 1,
			deviceId: receipt.deviceId,
			label: receipt.label,
			workerEndpoint: parseWorkerEndpoint(workerEndpoint),
			createdAt: receipt.createdAt
		});
	} catch {
		await credentialStore.clear(receipt.deviceId).catch(() => undefined);
		throw new DesktopPairingCodeError('desktop_ocr_pair_local_commit_failed_revoke_required');
	}

	return Object.freeze({
		deviceId: receipt.deviceId,
		label: receipt.label,
		status: 'active',
		createdAt: receipt.createdAt
	});
}
