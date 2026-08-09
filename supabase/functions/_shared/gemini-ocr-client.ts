import { parseOcrBatchPayload, type OcrBatchParseOutcome } from './ocr-batch-contract.ts';
import { parseOcrPayload, type OcrPayload } from './ocr-contract.ts';

export class GeminiTransportError extends Error {
	constructor() {
		super('Gemini transport failed');
		this.name = 'GeminiTransportError';
	}
}

export class GeminiHttpError extends Error {
	readonly status: number;
	readonly responseBody: string;

	constructor(status: number, responseBody: string) {
		super(`Gemini HTTP ${status}`);
		this.name = 'GeminiHttpError';
		this.status = status;
		this.responseBody = responseBody.slice(0, 8_000);
	}
}

export class GeminiResponseError extends Error {
	constructor() {
		super('Gemini response was invalid');
		this.name = 'GeminiResponseError';
	}
}

export type GeminiOcrRequest = {
	apiKey: string;
	model: string;
	mimeType: string;
	bytes: Uint8Array;
	promptVersion: number;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
};

export type GeminiOcrBatchPage = {
	pageId: string;
	pageNumber: number;
	mimeType: string;
	bytes: Uint8Array;
};

export type GeminiOcrBatchRequest = {
	apiKey: string;
	model: string;
	pages: readonly GeminiOcrBatchPage[];
	promptVersion: number;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = /^(?:image\/(?:jpeg|png|webp)|application\/pdf)$/;
const MAX_BATCH_PAGES = 100;
const MAX_PAGE_BYTES = 14 * 1024 * 1024;
// Gemini limits the entire inline request to 20 MB. Raw bytes expand by roughly
// one third when encoded as Base64, so the aggregate raw ceiling must stay well
// below 20 MB even before prompt/schema JSON overhead is added.
const MAX_BATCH_BYTES = 14 * 1024 * 1024;

const prompt = `Você é um transcritor literal de anotações acadêmicas.
Transcreva todo texto visível da imagem em português, preservando ordem de leitura, títulos, listas, quebras relevantes, símbolos e fórmulas em texto quando possível.
Não resuma, não explique, não complete lacunas e não adivinhe palavras ilegíveis.
Quando algo não puder ser lido com segurança, mantenha o trecho mais conservador possível e adicione um aviso curto.
Retorne exclusivamente o objeto JSON exigido pelo schema.`;

const warningSchema = {
	type: 'array',
	maxItems: 100,
	items: {
		type: 'object',
		additionalProperties: false,
		properties: {
			code: {
				type: 'string',
				enum: [
					'uncertain_text',
					'illegible_region',
					'layout_ambiguous',
					'formula_uncertain',
					'truncated_content',
					'empty_page'
				]
			},
			// Gemini's structured-output schema does not support maxLength; the
			// response parser enforces the 300-character safety limit instead.
			message: { type: 'string' }
		},
		required: ['code', 'message']
	}
} as const;

const responseSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		text: {
			type: 'string',
			description: 'Transcrição literal completa, sem comentários externos.'
		},
		warnings: warningSchema
	},
	required: ['text', 'warnings']
} as const;

const batchResponseSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		pages: {
			type: 'array',
			maxItems: MAX_BATCH_PAGES,
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					pageId: { type: 'string', description: 'Identificador UUID fornecido para a página.' },
					pageNumber: { type: 'integer', minimum: 1 },
					text: {
						type: 'string',
						description: 'Transcrição literal completa desta página.'
					},
					warnings: warningSchema
				},
				required: ['pageId', 'pageNumber', 'text', 'warnings']
			}
		}
	},
	required: ['pages']
} as const;

function base64(bytes: Uint8Array) {
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

function candidateText(payload: unknown): string | null {
	if (payload === null || typeof payload !== 'object') return null;
	const candidates = (payload as { candidates?: unknown }).candidates;
	if (!Array.isArray(candidates)) return null;
	for (const candidate of candidates) {
		if (candidate === null || typeof candidate !== 'object') continue;
		const content = (candidate as { content?: unknown }).content;
		if (content === null || typeof content !== 'object') continue;
		const parts = (content as { parts?: unknown }).parts;
		if (!Array.isArray(parts)) continue;
		for (const part of parts) {
			if (
				part &&
				typeof part === 'object' &&
				typeof (part as { text?: unknown }).text === 'string'
			) {
				return (part as { text: string }).text;
			}
		}
	}
	return null;
}

async function providerJson(response: Response) {
	if (!response.ok) throw new GeminiHttpError(response.status, await response.text());
	try {
		return await response.json();
	} catch {
		throw new GeminiResponseError();
	}
}

async function execute(
	request: Pick<GeminiOcrRequest, 'apiKey' | 'model' | 'signal' | 'fetchImpl'>,
	body: Record<string, unknown>
) {
	const fetchImpl = request.fetchImpl ?? fetch;
	let response: Response;
	try {
		response = await fetchImpl(
			`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
			{
				method: 'POST',
				headers: {
					'x-goog-api-key': request.apiKey,
					'Content-Type': 'application/json'
				},
				signal: request.signal,
				body: JSON.stringify(body)
			}
		);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new GeminiTransportError();
	}
	return providerJson(response);
}

function validateBatchPages(pages: readonly GeminiOcrBatchPage[]) {
	if (pages.length < 1 || pages.length > MAX_BATCH_PAGES) {
		throw new TypeError('Invalid Gemini OCR batch');
	}
	const ids = new Set<string>();
	const numbers = new Set<number>();
	let totalBytes = 0;
	for (const page of pages) {
		if (
			!UUID.test(page.pageId) ||
			!Number.isInteger(page.pageNumber) ||
			page.pageNumber < 1 ||
			page.pageNumber > 1_000_000 ||
			!MIME.test(page.mimeType) ||
			!(page.bytes instanceof Uint8Array) ||
			page.bytes.byteLength < 1 ||
			page.bytes.byteLength > MAX_PAGE_BYTES ||
			ids.has(page.pageId) ||
			numbers.has(page.pageNumber)
		) {
			throw new TypeError('Invalid Gemini OCR batch');
		}
		ids.add(page.pageId);
		numbers.add(page.pageNumber);
		totalBytes += page.bytes.byteLength;
	}
	if (totalBytes > MAX_BATCH_BYTES) throw new TypeError('Gemini OCR batch is too large');
}

export async function requestGeminiOcrBatch(
	request: GeminiOcrBatchRequest
): Promise<OcrBatchParseOutcome> {
	validateBatchPages(request.pages);
	const parts: Array<Record<string, unknown>> = [
		{
			text: `${prompt}\nCada imagem é precedida por seu pageId e número original. Não omita, duplique, reordene a identidade nem combine páginas. Retorne um item para cada imagem.\nVersão do prompt: ${request.promptVersion}.`
		}
	];
	for (const page of request.pages) {
		parts.push({
			text: `Início da página: pageId=${page.pageId}; página original ${page.pageNumber}.`
		});
		parts.push({
			inlineData: {
				mimeType: page.mimeType,
				data: base64(page.bytes)
			}
		});
	}

	const payload = await execute(request, {
		contents: [{ role: 'user', parts }],
		generationConfig: {
			maxOutputTokens: Math.min(65_536, Math.max(8_192, request.pages.length * 2_048)),
			responseMimeType: 'application/json',
			responseJsonSchema: batchResponseSchema
		}
	});
	const text = candidateText(payload);
	if (text === null) throw new GeminiResponseError();
	try {
		return parseOcrBatchPayload(
			text,
			request.pages.map(({ pageId, pageNumber }) => ({ pageId, pageNumber }))
		);
	} catch {
		throw new GeminiResponseError();
	}
}

export async function requestGeminiOcr(request: GeminiOcrRequest): Promise<OcrPayload> {
	const payload = await execute(request, {
		contents: [
			{
				role: 'user',
				parts: [
					{
						inlineData: {
							mimeType: request.mimeType,
							data: base64(request.bytes)
						}
					},
					{ text: `${prompt}\nVersão do prompt: ${request.promptVersion}.` }
				]
			}
		],
		generationConfig: {
			maxOutputTokens: 8192,
			responseMimeType: 'application/json',
			responseJsonSchema: responseSchema
		}
	});
	const text = candidateText(payload);
	if (text === null) throw new GeminiResponseError();
	try {
		return parseOcrPayload(text);
	} catch {
		throw new GeminiResponseError();
	}
}
