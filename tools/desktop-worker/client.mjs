import { requireCompletionRequest } from './contract.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;
const SAFE_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const SOURCE_MIME_TYPES = new Set(['image/webp', 'image/jpeg']);
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

function exactKeys(record, expected) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validTimestamp(value) {
	return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function parseEndpoint(value) {
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

function parseLease(value, expected = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	if (!exactKeys(value, ['jobId', 'pageId', 'deviceId', 'leaseId', 'leaseExpiresAt'])) return null;
	if (
		typeof value.jobId !== 'string' ||
		!UUID.test(value.jobId) ||
		typeof value.pageId !== 'string' ||
		!UUID.test(value.pageId) ||
		typeof value.deviceId !== 'string' ||
		!UUID.test(value.deviceId) ||
		typeof value.leaseId !== 'string' ||
		!UUID.test(value.leaseId) ||
		!validTimestamp(value.leaseExpiresAt) ||
		(expected.jobId && value.jobId !== expected.jobId) ||
		(expected.leaseId && value.leaseId !== expected.leaseId)
	) {
		return null;
	}
	return Object.freeze({ ...value });
}

function parseSourceUrl(value) {
	if (typeof value !== 'string' || value.length > 4096) return null;
	let url;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
	return url.toString();
}

function parseSource(value, expected) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	if (
		!exactKeys(value, [
			'jobId',
			'pageId',
			'documentId',
			'pageNumber',
			'leaseId',
			'leaseExpiresAt',
			'sourceUrl',
			'sourceUrlExpiresInSeconds',
			'sourceSha256',
			'mimeType',
			'sourceBytes'
		]) ||
		value.jobId !== expected.jobId ||
		value.leaseId !== expected.leaseId ||
		typeof value.pageId !== 'string' ||
		!UUID.test(value.pageId) ||
		typeof value.documentId !== 'string' ||
		!UUID.test(value.documentId) ||
		!Number.isSafeInteger(value.pageNumber) ||
		value.pageNumber < 1 ||
		!validTimestamp(value.leaseExpiresAt) ||
		typeof value.sourceSha256 !== 'string' ||
		!SHA256.test(value.sourceSha256) ||
		typeof value.mimeType !== 'string' ||
		!SOURCE_MIME_TYPES.has(value.mimeType) ||
		!Number.isSafeInteger(value.sourceBytes) ||
		value.sourceBytes < 1 ||
		value.sourceBytes > MAX_SOURCE_BYTES ||
		!Number.isSafeInteger(value.sourceUrlExpiresInSeconds) ||
		value.sourceUrlExpiresInSeconds < 1 ||
		value.sourceUrlExpiresInSeconds > 300
	) {
		return null;
	}
	const sourceUrl = parseSourceUrl(value.sourceUrl);
	if (!sourceUrl) return null;
	return Object.freeze({ ...value, sourceUrl });
}

function parseCompletion(value, expectedJobId) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	if (
		!exactKeys(value, [
			'jobId',
			'pageId',
			'resultId',
			'status',
			'idempotentReplay',
			'cleanupPending'
		]) ||
		value.jobId !== expectedJobId ||
		typeof value.pageId !== 'string' ||
		!UUID.test(value.pageId) ||
		typeof value.resultId !== 'string' ||
		!UUID.test(value.resultId) ||
		(value.status !== 'ready' && value.status !== 'needs_review') ||
		typeof value.idempotentReplay !== 'boolean' ||
		typeof value.cleanupPending !== 'boolean'
	) {
		return null;
	}
	return Object.freeze({ ...value });
}

async function readJsonResponse(response) {
	const text = await response.text();
	if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
		throw new DesktopWorkerApiError(response.status, 'worker_response_too_large');
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new DesktopWorkerApiError(response.status, 'worker_response_invalid');
	}
}

function errorCode(value) {
	if (
		value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		typeof value.code === 'string' &&
		SAFE_CODE.test(value.code)
	) {
		return value.code;
	}
	return 'worker_request_failed';
}

export class DesktopWorkerApiError extends Error {
	constructor(httpStatus, code) {
		super(`Desktop worker request failed (${code})`);
		this.name = 'DesktopWorkerApiError';
		this.httpStatus = httpStatus;
		this.code = code;
	}
}

export class DesktopWorkerClient {
	#endpoint;
	#credential;
	#fetch;
	#timeoutMs;

	constructor({ endpoint, credential, fetchImpl = fetch, timeoutMs = 30_000 }) {
		this.#endpoint = parseEndpoint(endpoint);
		if (typeof credential !== 'string' || !CREDENTIAL.test(credential)) {
			throw new TypeError('Invalid desktop worker credential');
		}
		if (typeof fetchImpl !== 'function') throw new TypeError('Invalid desktop worker fetch implementation');
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
			throw new TypeError('Invalid desktop worker request timeout');
		}
		this.#credential = credential;
		this.#fetch = fetchImpl;
		this.#timeoutMs = timeoutMs;
	}

	async #request(payload, { signal, allowEmpty = false } = {}) {
		const timeout = AbortSignal.timeout(this.#timeoutMs);
		const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
		let response;
		try {
			response = await this.#fetch(this.#endpoint, {
				method: 'POST',
				headers: {
					Authorization: `FicharioWorker ${this.#credential}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload),
				redirect: 'error',
				signal: requestSignal
			});
		} catch (error) {
			if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
			throw new DesktopWorkerApiError(0, 'worker_network_failed');
		}
		if (allowEmpty && response.status === 204) return null;
		const body = await readJsonResponse(response);
		if (!response.ok) throw new DesktopWorkerApiError(response.status, errorCode(body));
		return body;
	}

	async claim(options = {}) {
		const body = await this.#request({ action: 'claim' }, { ...options, allowEmpty: true });
		if (body === null) return null;
		const lease = parseLease(body);
		if (!lease) throw new DesktopWorkerApiError(200, 'worker_response_invalid');
		return lease;
	}

	async renew(jobId, leaseId, options = {}) {
		const body = await this.#request({ action: 'renew', jobId, leaseId }, options);
		const lease = parseLease(body, { jobId, leaseId });
		if (!lease) throw new DesktopWorkerApiError(200, 'worker_response_invalid');
		return lease;
	}

	async source(jobId, leaseId, options = {}) {
		const body = await this.#request({ action: 'source', jobId, leaseId }, options);
		const source = parseSource(body, { jobId, leaseId });
		if (!source) throw new DesktopWorkerApiError(200, 'worker_response_invalid');
		return source;
	}

	async complete(payload, options = {}) {
		const request = requireCompletionRequest(payload);
		const body = await this.#request(request, options);
		const completion = parseCompletion(body, request.jobId);
		if (!completion) throw new DesktopWorkerApiError(200, 'worker_response_invalid');
		return completion;
	}
}
