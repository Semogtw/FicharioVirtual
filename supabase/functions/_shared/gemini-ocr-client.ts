import { readBoundedResponseJson, readBoundedResponseText } from './bounded-response.ts';
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

export type GeminiTokenDetail = Readonly<{
	modality: string;
	tokenCount: number;
}>;

export type GeminiUsageMetadata = Readonly<{
	promptTokenCount: number | null;
	cachedContentTokenCount: number | null;
	candidatesTokenCount: number | null;
	toolUsePromptTokenCount: number | null;
	thoughtsTokenCount: number | null;
	totalTokenCount: number | null;
	promptTokensDetails: readonly GeminiTokenDetail[];
	cacheTokensDetails: readonly GeminiTokenDetail[];
	candidatesTokensDetails: readonly GeminiTokenDetail[];
	toolUsePromptTokensDetails: readonly GeminiTokenDetail[];
	serviceTier: string | null;
}>;

export type GeminiOcrBatchOutcome = OcrBatchParseOutcome &
	Readonly<{
		usage: GeminiUsageMetadata | null;
		modelVersion: string | null;
		responseId: string | null;
	}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = /^(?:image\/(?:jpeg|png|webp)|application\/pdf)$/;
const MODALITY = /^[A-Z][A-Z0-9_]{0,63}$/;
const SERVICE_TIER = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_BATCH_PAGES = 100;
const MAX_PAGE_BYTES = 14 * 1024 * 1024;
// Gemini limits the entire inline request to 20 MB. Raw bytes expand by roughly
// one third when encoded as Base64, so the aggregate raw ceiling must stay well
// below 20 MB even before prompt/schema JSON overhead is added.
const MAX_BATCH_BYTES = 14 * 1024 * 1024;
const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_TOKEN_COUNT = Number.MAX_SAFE_INTEGER;

const prompt = `Você é um transcritor literal de anotações acadêmicas.
Transcreva todo texto visível da imagem em português, preservando ordem de leitura, títulos, listas, quebras relevantes, símbolos e fórmulas em texto quando possível.
Não resuma, não explique, não complete lacunas e não adivinhe palavras ilegíveis.
Quando algo não puder ser lido com segurança, mantenha o trecho mais conservador possível e adicione um aviso curto.
Quando o contrato pedir wordGeometry, localize cada palavra visível usando a mesma grafia retornada na transcrição. Cada caixa usa coordenadas inteiras normalizadas de 0 a 10000, origem no canto superior esquerdo, no formato compacto esquerda,topo,direita,base|palavra. Não invente caixas para texto não visível e não inclua comentários na geometria.
Retorne exclusivamente JSON válido e cumpra exatamente o contrato JSON descrito na instrução da requisição.`;

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

const wordGeometrySchema = {
	type: 'array',
	maxItems: 20_000,
	items: {
		type: 'string',
		description:
			'Uma palavra visível no formato esquerda,topo,direita,base|palavra; coordenadas inteiras entre 0 e 10000, origem superior esquerda.'
	}
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
					contentClass: {
						type: 'string',
						enum: [
							'unknown',
							'book_clean',
							'scan_degraded',
							'handwriting',
							'mixed',
							'table_layout',
							'math',
							'sparse'
						],
						description:
							'Classificação visual conservadora para telemetria. Use unknown quando não houver uma classe dominante segura.'
					},
					wordGeometry: wordGeometrySchema,
					warnings: warningSchema
				},
				required: ['pageId', 'pageNumber', 'text', 'contentClass', 'wordGeometry', 'warnings']
			}
		}
	},
	required: ['pages']
} as const;

function outputContract(schema: unknown) {
	return `Contrato JSON obrigatório (não repita o schema; devolva apenas o objeto final): ${JSON.stringify(schema)}. Não inclua propriedades extras.`;
}

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

function safeTokenCount(value: unknown): number | null {
	return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_TOKEN_COUNT
		? Number(value)
		: null;
}

function tokenDetails(value: unknown): readonly GeminiTokenDetail[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	const details: GeminiTokenDetail[] = [];
	for (const item of value.slice(0, 32)) {
		if (!item || typeof item !== 'object') continue;
		const modality = (item as { modality?: unknown }).modality;
		const count = safeTokenCount((item as { tokenCount?: unknown }).tokenCount);
		if (typeof modality !== 'string' || !MODALITY.test(modality) || count === null) continue;
		details.push(Object.freeze({ modality, tokenCount: count }));
	}
	return Object.freeze(details);
}

function usageMetadata(payload: unknown): GeminiUsageMetadata | null {
	if (!payload || typeof payload !== 'object') return null;
	const raw = (payload as { usageMetadata?: unknown }).usageMetadata;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	const serviceTier =
		typeof record.serviceTier === 'string' && SERVICE_TIER.test(record.serviceTier)
			? record.serviceTier
			: null;
	return Object.freeze({
		promptTokenCount: safeTokenCount(record.promptTokenCount),
		cachedContentTokenCount: safeTokenCount(record.cachedContentTokenCount),
		candidatesTokenCount: safeTokenCount(record.candidatesTokenCount),
		toolUsePromptTokenCount: safeTokenCount(record.toolUsePromptTokenCount),
		thoughtsTokenCount: safeTokenCount(record.thoughtsTokenCount),
		totalTokenCount: safeTokenCount(record.totalTokenCount),
		promptTokensDetails: tokenDetails(record.promptTokensDetails),
		cacheTokensDetails: tokenDetails(record.cacheTokensDetails),
		candidatesTokensDetails: tokenDetails(record.candidatesTokensDetails),
		toolUsePromptTokensDetails: tokenDetails(record.toolUsePromptTokensDetails),
		serviceTier
	});
}

function providerString(payload: unknown, key: 'modelVersion' | 'responseId', maxLength: number) {
	if (!payload || typeof payload !== 'object') return null;
	const value = (payload as Record<string, unknown>)[key];
	return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

async function providerJson(response: Response) {
	if (!response.ok) {
		let responseBody = '';
		try {
			responseBody = await readBoundedResponseText(response, MAX_PROVIDER_ERROR_BYTES);
		} catch {
			// Provider error bodies are diagnostic only. Status remains authoritative.
		}
		throw new GeminiHttpError(response.status, responseBody);
	}
	try {
		return await readBoundedResponseJson(response, MAX_PROVIDER_RESPONSE_BYTES);
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
): Promise<GeminiOcrBatchOutcome> {
	validateBatchPages(request.pages);
	const parts: Array<Record<string, unknown>> = [
		{
			text: `${prompt}\nCada imagem é precedida por seu pageId e número original. Não omita, duplique, reordene a identidade nem combine páginas. Classifique visualmente cada página em contentClass usando somente a enumeração fornecida; a classe é telemetria e nunca deve alterar, resumir ou normalizar a transcrição. Em wordGeometry, inclua uma entrada compacta para cada palavra que puder ser localizada visualmente com segurança. Retorne um item para cada imagem.\n${outputContract(batchResponseSchema)}\nVersão do prompt: ${request.promptVersion}.`
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
			maxOutputTokens: Math.min(65_536, Math.max(8_192, request.pages.length * 4_096)),
			responseMimeType: 'application/json'
		}
	});
	const text = candidateText(payload);
	if (text === null) throw new GeminiResponseError();
	try {
		const parsed = parseOcrBatchPayload(
			text,
			request.pages.map(({ pageId, pageNumber }) => ({ pageId, pageNumber }))
		);
		return Object.freeze({
			...parsed,
			usage: usageMetadata(payload),
			modelVersion: providerString(payload, 'modelVersion', 200),
			responseId: providerString(payload, 'responseId', 256)
		});
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
					{
						text: `${prompt}\n${outputContract(responseSchema)}\nVersão do prompt: ${request.promptVersion}.`
					}
				]
			}
		],
		generationConfig: {
			maxOutputTokens: 8192,
			responseMimeType: 'application/json'
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
