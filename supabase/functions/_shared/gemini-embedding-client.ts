import { readBoundedResponseJson, readBoundedResponseText } from './bounded-response.ts';

const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const MAX_INPUTS = 64;
const MAX_INPUT_CHARS = 16_000;
const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;

export type GeminiEmbeddingTask = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT';

export type GeminiEmbeddingInput = Readonly<{
	text: string;
	title?: string;
}>;

export type GeminiEmbeddingRequest = Readonly<{
	apiKey: string;
	model: string;
	inputs: readonly GeminiEmbeddingInput[];
	taskType: GeminiEmbeddingTask;
	outputDimensionality: number;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}>;

export class GeminiEmbeddingTransportError extends Error {
	constructor() {
		super('Gemini embedding transport failed');
		this.name = 'GeminiEmbeddingTransportError';
	}
}

export class GeminiEmbeddingHttpError extends Error {
	readonly status: number;
	readonly responseBody: string;

	constructor(status: number, responseBody: string) {
		super(`Gemini embedding HTTP ${status}`);
		this.name = 'GeminiEmbeddingHttpError';
		this.status = status;
		this.responseBody = responseBody.slice(0, 8_000);
	}
}

export class GeminiEmbeddingResponseError extends Error {
	constructor() {
		super('Gemini embedding response was invalid');
		this.name = 'GeminiEmbeddingResponseError';
	}
}

function validateRequest(request: GeminiEmbeddingRequest) {
	if (!request.apiKey || !MODEL.test(request.model)) throw new TypeError('Invalid Gemini embedding configuration');
	if (
		!Number.isInteger(request.outputDimensionality) ||
		request.outputDimensionality < 128 ||
		request.outputDimensionality > 3_072
	) {
		throw new TypeError('Invalid Gemini embedding dimensionality');
	}
	if (request.inputs.length < 1 || request.inputs.length > MAX_INPUTS) {
		throw new TypeError('Invalid Gemini embedding batch');
	}
	for (const input of request.inputs) {
		if (
			typeof input.text !== 'string' ||
			input.text.trim().length < 1 ||
			input.text.length > MAX_INPUT_CHARS ||
			(input.title !== undefined && (input.title.trim().length < 1 || input.title.length > 512))
		) {
			throw new TypeError('Invalid Gemini embedding input');
		}
	}
}

function normalizedVector(value: unknown, dimensions: number): readonly number[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new GeminiEmbeddingResponseError();
	}
	const values = (value as { values?: unknown }).values;
	if (
		!Array.isArray(values) ||
		values.length !== dimensions ||
		values.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
	) {
		throw new GeminiEmbeddingResponseError();
	}
	const vector = values as number[];
	const norm = Math.sqrt(vector.reduce((sum, entry) => sum + entry * entry, 0));
	if (!Number.isFinite(norm) || norm <= 0) throw new GeminiEmbeddingResponseError();
	return Object.freeze(vector.map((entry) => entry / norm));
}

async function providerJson(response: Response) {
	if (!response.ok) {
		let body = '';
		try {
			body = await readBoundedResponseText(response, MAX_PROVIDER_ERROR_BYTES);
		} catch {
			// Provider body is diagnostic only; the HTTP status remains authoritative.
		}
		throw new GeminiEmbeddingHttpError(response.status, body);
	}
	try {
		return await readBoundedResponseJson(response, MAX_PROVIDER_RESPONSE_BYTES);
	} catch {
		throw new GeminiEmbeddingResponseError();
	}
}

export async function requestGeminiEmbeddings(
	request: GeminiEmbeddingRequest
): Promise<readonly (readonly number[])[]> {
	validateRequest(request);
	const fetchImpl = request.fetchImpl ?? fetch;
	const modelResource = `models/${request.model}`;
	const requests = request.inputs.map((input) => ({
		model: modelResource,
		content: { parts: [{ text: input.text }] },
		embedContentConfig: {
			taskType: request.taskType,
			outputDimensionality: request.outputDimensionality,
			autoTruncate: true,
			...(request.taskType === 'RETRIEVAL_DOCUMENT' && input.title
				? { title: input.title.trim() }
				: {})
		}
	}));

	let response: Response;
	try {
		response = await fetchImpl(
			`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:batchEmbedContents`,
			{
				method: 'POST',
				headers: {
					'x-goog-api-key': request.apiKey,
					'Content-Type': 'application/json'
				},
				signal: request.signal,
				body: JSON.stringify({ requests })
			}
		);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new GeminiEmbeddingTransportError();
	}

	const payload = await providerJson(response);
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new GeminiEmbeddingResponseError();
	}
	const embeddings = (payload as { embeddings?: unknown }).embeddings;
	if (!Array.isArray(embeddings) || embeddings.length !== request.inputs.length) {
		throw new GeminiEmbeddingResponseError();
	}
	return Object.freeze(
		embeddings.map((embedding) => normalizedVector(embedding, request.outputDimensionality))
	);
}

export function embeddingVectorText(values: readonly number[]) {
	if (
		values.length < 1 ||
		values.length > 3_072 ||
		values.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
	) {
		throw new TypeError('Invalid embedding vector');
	}
	return `[${values.map((entry) => entry.toPrecision(12)).join(',')}]`;
}
