import { readBoundedResponseJson } from './bounded-response.ts';
import { parseAzureReadOperation } from './azure-ocr-contract.ts';
import type { OcrProvider, OcrProviderBatchRequest, OcrProviderOutcome } from './ocr-provider.ts';

export class AzureOcrTransportError extends Error {
	constructor() {
		super('Azure OCR transport failed');
		this.name = 'AzureOcrTransportError';
	}
}

export class AzureOcrHttpError extends Error {
	readonly status: number;

	constructor(status: number) {
		super(`Azure OCR HTTP ${status}`);
		this.name = 'AzureOcrHttpError';
		this.status = status;
	}
}

export class AzureOcrResponseError extends Error {
	constructor() {
		super('Azure OCR response was invalid');
		this.name = 'AzureOcrResponseError';
	}
}

export class AzureOcrOperationFailedError extends Error {
	constructor() {
		super('Azure OCR operation failed');
		this.name = 'AzureOcrOperationFailedError';
	}
}

export class AzureOcrEligibilityError extends Error {
	constructor() {
		super('Page is not eligible for Azure OCR');
		this.name = 'AzureOcrEligibilityError';
	}
}

type SleepImpl = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export type AzureOcrProviderOptions = Readonly<{
	endpoint: string;
	apiKey: string;
	maxImageBytes?: number;
	pollIntervalMs?: number;
	pollTimeoutMs?: number;
	reviewConfidence?: number | null;
	fetchImpl?: typeof fetch;
	sleepImpl?: SleepImpl;
}>;

const DEFAULT_MAX_IMAGE_BYTES = 3_800_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const AZURE_RESOURCE_HOST = /^[a-z0-9-]{2,64}\.cognitiveservices\.azure\.com$/iu;
const AZURE_REGIONAL_HOST = /^[a-z0-9-]{2,64}\.api\.cognitive\.microsoft\.com$/iu;
const AZURE_IMAGE_MIME = /^(?:image\/jpeg|image\/png)$/u;

function positiveInteger(value: number | undefined, fallback: number, maximum: number) {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
		throw new TypeError('Invalid Azure OCR numeric configuration');
	}
	return resolved;
}

function parseReviewConfidence(value: number | null | undefined) {
	if (value === undefined || value === null) return null;
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new TypeError('Invalid Azure OCR review confidence');
	}
	return value;
}

function parseEndpoint(value: string) {
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		throw new TypeError('Invalid Azure OCR endpoint');
	}
	if (
		endpoint.protocol !== 'https:' ||
		endpoint.username !== '' ||
		endpoint.password !== '' ||
		endpoint.search !== '' ||
		endpoint.hash !== '' ||
		(endpoint.pathname !== '' && endpoint.pathname !== '/') ||
		(!AZURE_RESOURCE_HOST.test(endpoint.hostname) && !AZURE_REGIONAL_HOST.test(endpoint.hostname))
	) {
		throw new TypeError('Invalid Azure OCR endpoint');
	}
	return new URL(endpoint.origin);
}

function operationIdFromLocation(value: string | null, endpoint: URL) {
	if (!value || value.length > 2_048) return null;
	let location: URL;
	try {
		location = new URL(value);
	} catch {
		return null;
	}
	if (location.origin !== endpoint.origin || location.search !== '' || location.hash !== '')
		return null;
	const prefix = '/vision/v3.2/read/analyzeResults/';
	if (!location.pathname.startsWith(prefix)) return null;
	const operationId = location.pathname.slice(prefix.length);
	return OPERATION_ID.test(operationId) ? operationId : null;
}

async function defaultSleep(milliseconds: number, signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', abort);
			resolve();
		}, milliseconds);
		const abort = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', abort, { once: true });
	});
}

async function providerFetch(fetchImpl: typeof fetch, input: string, init: RequestInit) {
	try {
		return await fetchImpl(input, { ...init, redirect: 'error' });
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new AzureOcrTransportError();
	}
}

export function createAzureOcrProvider(options: AzureOcrProviderOptions): OcrProvider {
	const endpoint = parseEndpoint(options.endpoint);
	if (options.apiKey.length < 1 || options.apiKey.length > 4_096) {
		throw new TypeError('Invalid Azure OCR credential');
	}
	const maxImageBytes = positiveInteger(options.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES, 3_999_999);
	const pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 60_000);
	const pollTimeoutMs = positiveInteger(options.pollTimeoutMs, DEFAULT_POLL_TIMEOUT_MS, 180_000);
	if (pollTimeoutMs < pollIntervalMs)
		throw new TypeError('Invalid Azure OCR polling configuration');
	const reviewConfidence = parseReviewConfidence(options.reviewConfidence);
	const fetchImpl = options.fetchImpl ?? fetch;
	const sleepImpl = options.sleepImpl ?? defaultSleep;
	const analyzeUrl = `${endpoint.origin}/vision/v3.2/read/analyze`;

	return Object.freeze({
		id: 'azure_vision' as const,
		async requestBatch(request: OcrProviderBatchRequest): Promise<OcrProviderOutcome> {
			if (request.pages.length !== 1 || request.model !== 'read-v3.2') {
				throw new AzureOcrEligibilityError();
			}
			const page = request.pages[0]!;
			if (
				!AZURE_IMAGE_MIME.test(page.mimeType) ||
				!(page.bytes instanceof Uint8Array) ||
				page.bytes.byteLength < 1 ||
				page.bytes.byteLength > maxImageBytes
			) {
				throw new AzureOcrEligibilityError();
			}

			const submission = await providerFetch(fetchImpl, analyzeUrl, {
				method: 'POST',
				headers: {
					'Ocp-Apim-Subscription-Key': options.apiKey,
					'Content-Type': page.mimeType
				},
				body: page.bytes,
				signal: request.signal
			});
			if (submission.status !== 202) throw new AzureOcrHttpError(submission.status);
			const operationId = operationIdFromLocation(
				submission.headers.get('Operation-Location'),
				endpoint
			);
			if (!operationId) throw new AzureOcrResponseError();
			const resultUrl = `${endpoint.origin}/vision/v3.2/read/analyzeResults/${encodeURIComponent(operationId)}`;
			const startedAt = Date.now();
			let polls = 0;

			while (Date.now() - startedAt < pollTimeoutMs) {
				await sleepImpl(pollIntervalMs, request.signal);
				if (Date.now() - startedAt >= pollTimeoutMs) break;
				const response = await providerFetch(fetchImpl, resultUrl, {
					method: 'GET',
					headers: { 'Ocp-Apim-Subscription-Key': options.apiKey },
					signal: request.signal
				});
				polls += 1;
				if (response.status !== 200) throw new AzureOcrHttpError(response.status);
				let body: unknown;
				try {
					body = await readBoundedResponseJson(response, MAX_PROVIDER_RESPONSE_BYTES);
				} catch {
					throw new AzureOcrResponseError();
				}
				const parsed = parseAzureReadOperation(
					body,
					{ pageId: page.pageId, pageNumber: page.pageNumber },
					reviewConfidence
				);
				if (!parsed) throw new AzureOcrResponseError();
				if (parsed.state === 'failed') throw new AzureOcrOperationFailedError();
				if (parsed.state === 'running') continue;
				if (!parsed.page) throw new AzureOcrResponseError();

				return Object.freeze({
					valid: true,
					pages: Object.freeze([parsed.page]),
					missingPageIds: Object.freeze([]),
					duplicatePageIds: Object.freeze([]),
					unexpectedPageIds: Object.freeze([]),
					provider: 'azure_vision' as const,
					model: request.model,
					providerModelVersion: parsed.modelVersion,
					providerResponseId: operationId,
					usage: Object.freeze({
						requestCount: 1,
						inputTokens: null,
						outputTokens: null,
						totalTokens: null
					})
				});
			}

			void polls;
			throw new AzureOcrTransportError();
		}
	});
}
