import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const SHA256 = /^[0-9a-f]{64}$/;
const MODEL = /^[A-Za-z0-9._:/-]+$/;
const SOURCE_MIME_TYPES = new Set(['image/webp', 'image/jpeg']);
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_TIMING_MS = 86_400_000;
const MAX_WORD_GEOMETRY = 20_000;
const COMPACT_GEOMETRY = /^(\d{1,5}),(\d{1,5}),(\d{1,5}),(\d{1,5})\|(.+)$/u;
const WARNING_CODES = new Set([
	'low_legibility',
	'uncertain_characters',
	'layout_complex',
	'possible_omission'
]);
const WARNING_MESSAGES = Object.freeze({
	low_legibility: 'A imagem contém trechos de baixa legibilidade.',
	uncertain_characters: 'Há caracteres cuja leitura pode estar incorreta.',
	layout_complex: 'O layout da página pode ter prejudicado a ordem do texto.',
	possible_omission: 'Pode haver conteúdo visual que não foi transcrito integralmente.'
});

const OCR_SCHEMA = Object.freeze({
	type: 'object',
	additionalProperties: false,
	properties: {
		rawText: { type: 'string' },
		contentType: { type: 'string', enum: ['printed', 'handwritten', 'mixed', 'unknown'] },
		wordGeometry: {
			type: 'array',
			maxItems: MAX_WORD_GEOMETRY,
			items: { type: 'string' }
		},
		warnings: {
			type: 'array',
			maxItems: 4,
			items: {
				type: 'string',
				enum: [...WARNING_CODES]
			}
		},
		needsReview: { type: 'boolean' }
	},
	required: ['rawText', 'contentType', 'wordGeometry', 'warnings', 'needsReview']
});

const OCR_PROMPT = `Transcreva fielmente todo o texto visível desta página para rawText.
Não resuma, não explique e não invente conteúdo ausente.
Preserve quebras de linha quando ajudarem a representar parágrafos, listas ou tabelas.
Classifique contentType como printed, handwritten, mixed ou unknown.
Para wordGeometry, localize cada palavra visível usando exatamente a grafia de rawText. Use coordenadas inteiras normalizadas de 0 a 10000, origem no canto superior esquerdo, e o formato compacto esquerda,topo,direita,base|palavra. Não invente caixas para texto que não puder localizar com segurança.
Use warnings somente quando aplicável: low_legibility, uncertain_characters, layout_complex, possible_omission.
Marque needsReview=true se qualquer parte relevante estiver incerta, ilegível, possivelmente omitida ou com ordem duvidosa.
Responda estritamente no JSON solicitado pelo schema.`;

function parseBaseUrl(value) {
	if (typeof value !== 'string' || value.length > 2048) {
		throw new TypeError('Invalid Ollama loopback URL');
	}
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError('Invalid Ollama loopback URL');
	}
	if (
		url.protocol !== 'http:' ||
		(url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/'
	) {
		throw new TypeError('Ollama must use a loopback-only HTTP endpoint');
	}
	return url;
}

function requireModel(value) {
	if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !MODEL.test(value)) {
		throw new TypeError('Invalid Ollama model id');
	}
	return value;
}

function requireDigest(value) {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError('Invalid Ollama model digest');
	}
	return value;
}

function jsonContentType(response) {
	return (
		response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ===
		'application/json'
	);
}

async function readBoundedJson(response) {
	if (!jsonContentType(response)) throw new OllamaEngineError('ollama_response_type_invalid');
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		if (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_API_RESPONSE_BYTES) {
			throw new OllamaEngineError('ollama_response_too_large');
		}
	}
	if (!response.body) throw new OllamaEngineError('ollama_response_invalid');
	const chunks = [];
	let total = 0;
	for await (const chunk of response.body) {
		const bytes = Buffer.from(chunk);
		total += bytes.byteLength;
		if (total > MAX_API_RESPONSE_BYTES) throw new OllamaEngineError('ollama_response_too_large');
		chunks.push(bytes);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new OllamaEngineError('ollama_response_invalid');
	}
}

async function requestJson(fetchImpl, url, init, signal) {
	let response;
	try {
		response = await fetchImpl(url, { ...init, redirect: 'error', signal });
	} catch (error) {
		if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
		throw new OllamaEngineError('ollama_unavailable');
	}
	const body = await readBoundedJson(response);
	if (!response.ok) throw new OllamaEngineError('ollama_request_failed');
	return body;
}

function findPinnedModel(body, model, expectedDigest) {
	if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.models)) {
		throw new OllamaEngineError('ollama_models_invalid');
	}
	const candidate = body.models.find(
		(item) =>
			item &&
			typeof item === 'object' &&
			!Array.isArray(item) &&
			(item.name === model || item.model === model)
	);
	if (!candidate) throw new OllamaEngineError('ollama_model_missing');
	if (candidate.digest !== expectedDigest)
		throw new OllamaEngineError('ollama_model_digest_mismatch');
	if (
		(typeof candidate.remote_model === 'string' && candidate.remote_model.length > 0) ||
		(typeof candidate.remote_host === 'string' && candidate.remote_host.length > 0)
	) {
		throw new OllamaEngineError('ollama_remote_model_forbidden');
	}
}

function requireVisionCapabilities(body) {
	if (
		!body ||
		typeof body !== 'object' ||
		Array.isArray(body) ||
		!Array.isArray(body.capabilities) ||
		!body.capabilities.includes('vision')
	) {
		throw new OllamaEngineError('ollama_model_not_vision');
	}
}

function parseWordGeometry(value) {
	if (value === undefined) return Object.freeze([]);
	if (!Array.isArray(value) || value.length > MAX_WORD_GEOMETRY) {
		throw new OllamaEngineError('ollama_ocr_invalid');
	}
	const geometry = [];
	for (const item of value) {
		if (typeof item !== 'string' || item.length > 320) continue;
		const match = COMPACT_GEOMETRY.exec(item);
		if (!match) continue;
		const left = Number(match[1]);
		const top = Number(match[2]);
		const right = Number(match[3]);
		const bottom = Number(match[4]);
		const text = match[5]?.trim() ?? '';
		if (
			text.length < 1 ||
			text.length > 256 ||
			![left, top, right, bottom].every(Number.isSafeInteger) ||
			left < 0 ||
			top < 0 ||
			right > 10_000 ||
			bottom > 10_000 ||
			right <= left ||
			bottom <= top
		) {
			continue;
		}
		geometry.push(Object.freeze([text, left, top, right, bottom]));
	}
	return Object.freeze(geometry);
}

function parseOcrContent(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new OllamaEngineError('ollama_ocr_invalid');
	}
	const keys = Object.keys(value).sort();
	const legacy = ['contentType', 'needsReview', 'rawText', 'warnings'];
	const withGeometry = ['contentType', 'needsReview', 'rawText', 'warnings', 'wordGeometry'].sort();
	if (
		(keys.length !== legacy.length || !keys.every((key, index) => key === legacy[index])) &&
		(keys.length !== withGeometry.length || !keys.every((key, index) => key === withGeometry[index]))
	) {
		throw new OllamaEngineError('ollama_ocr_invalid');
	}
	if (typeof value.rawText !== 'string' || value.rawText.length > MAX_TEXT_LENGTH) {
		throw new OllamaEngineError('ollama_ocr_invalid');
	}
	if (!['printed', 'handwritten', 'mixed', 'unknown'].includes(value.contentType)) {
		throw new OllamaEngineError('ollama_ocr_invalid');
	}
	if (
		typeof value.needsReview !== 'boolean' ||
		!Array.isArray(value.warnings) ||
		value.warnings.length > 4
	) {
		throw new OllamaEngineError('ollama_ocr_invalid');
	}
	const seen = new Set();
	const warnings = [];
	for (const code of value.warnings) {
		if (typeof code !== 'string' || !WARNING_CODES.has(code) || seen.has(code)) {
			throw new OllamaEngineError('ollama_ocr_invalid');
		}
		seen.add(code);
		warnings.push(Object.freeze({ code, message: WARNING_MESSAGES[code] }));
	}
	if (warnings.length > 0 && value.needsReview !== true) {
		throw new OllamaEngineError('ollama_ocr_invalid');
	}
	return Object.freeze({
		rawText: value.rawText,
		correctedText: null,
		contentType: value.contentType,
		wordGeometry: parseWordGeometry(value.wordGeometry),
		warnings: Object.freeze(warnings),
		needsReview: value.needsReview
	});
}

async function readPrivateSource(input) {
	if (
		!input ||
		typeof input !== 'object' ||
		Array.isArray(input) ||
		typeof input.path !== 'string' ||
		!Number.isSafeInteger(input.bytes) ||
		input.bytes < 1 ||
		input.bytes > MAX_SOURCE_BYTES ||
		typeof input.sha256 !== 'string' ||
		!SHA256.test(input.sha256) ||
		typeof input.mimeType !== 'string' ||
		!SOURCE_MIME_TYPES.has(input.mimeType)
	) {
		throw new TypeError('Invalid Ollama OCR source');
	}
	let handle;
	try {
		handle = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const details = await handle.stat();
		if (!details.isFile() || details.size !== input.bytes || details.size > MAX_SOURCE_BYTES) {
			throw new OllamaEngineError('ollama_source_changed');
		}
		const bytes = await handle.readFile();
		if (createHash('sha256').update(bytes).digest('hex') !== input.sha256) {
			throw new OllamaEngineError('ollama_source_changed');
		}
		return bytes;
	} catch (error) {
		if (error instanceof OllamaEngineError) throw error;
		throw new OllamaEngineError('ollama_source_unavailable');
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

export class OllamaEngineError extends Error {
	constructor(code) {
		super(`Desktop worker Ollama engine failed (${code})`);
		this.name = 'OllamaEngineError';
		this.code = code;
	}
}

export class OllamaOcrEngine {
	#baseUrl;
	#model;
	#expectedDigest;
	#fetch;
	#verifiedDigest = null;

	constructor({ model, expectedDigest, baseUrl = 'http://127.0.0.1:11434/', fetchImpl = fetch }) {
		this.#baseUrl = parseBaseUrl(baseUrl);
		this.#model = requireModel(model);
		this.#expectedDigest = requireDigest(expectedDigest);
		if (typeof fetchImpl !== 'function') throw new TypeError('Invalid Ollama fetch implementation');
		this.#fetch = fetchImpl;
	}

	async #verifyModel(signal) {
		const tags = await requestJson(
			this.#fetch,
			new URL('/api/tags', this.#baseUrl),
			{ method: 'GET', headers: { Accept: 'application/json' } },
			signal
		);
		findPinnedModel(tags, this.#model, this.#expectedDigest);
		if (this.#verifiedDigest === this.#expectedDigest) return;
		const shown = await requestJson(
			this.#fetch,
			new URL('/api/show', this.#baseUrl),
			{
				method: 'POST',
				headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: this.#model, verbose: false })
			},
			signal
		);
		requireVisionCapabilities(shown);
		this.#verifiedDigest = this.#expectedDigest;
	}

	async process(input, { signal } = {}) {
		const startedAt = performance.now();
		await this.#verifyModel(signal);
		const bytes = await readPrivateSource(input);
		const response = await requestJson(
			this.#fetch,
			new URL('/api/chat', this.#baseUrl),
			{
				method: 'POST',
				headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: this.#model,
					messages: [
						{
							role: 'user',
							content: OCR_PROMPT,
							images: [bytes.toString('base64')]
						}
					],
					stream: false,
					think: false,
					format: OCR_SCHEMA,
					options: { temperature: 0 }
				})
			},
			signal
		);
		if (
			!response ||
			typeof response !== 'object' ||
			Array.isArray(response) ||
			response.done !== true ||
			!response.message ||
			typeof response.message !== 'object' ||
			response.message.role !== 'assistant' ||
			typeof response.message.content !== 'string'
		) {
			throw new OllamaEngineError('ollama_response_invalid');
		}
		let parsed;
		try {
			parsed = JSON.parse(response.message.content);
		} catch {
			throw new OllamaEngineError('ollama_ocr_invalid');
		}
		const ocr = parseOcrContent(parsed);
		const timingMs = Math.round(performance.now() - startedAt);
		if (!Number.isSafeInteger(timingMs) || timingMs < 0 || timingMs > MAX_TIMING_MS) {
			throw new OllamaEngineError('ollama_timing_invalid');
		}
		return Object.freeze({
			backend: 'ollama',
			modelId: this.#model,
			modelVersion: `sha256:${this.#expectedDigest}`,
			...ocr,
			timingMs
		});
	}
}
