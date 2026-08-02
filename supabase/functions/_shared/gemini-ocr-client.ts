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

const prompt = `Você é um transcritor literal de anotações acadêmicas.
Transcreva todo texto visível da imagem em português, preservando ordem de leitura, títulos, listas, quebras relevantes, símbolos e fórmulas em texto quando possível.
Não resuma, não explique, não complete lacunas e não adivinhe palavras ilegíveis.
Quando algo não puder ser lido com segurança, mantenha o trecho mais conservador possível e adicione um aviso curto.
Retorne exclusivamente o objeto JSON exigido pelo schema.`;

const responseSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		text: { type: 'string', description: 'Transcrição literal completa, sem comentários externos.' },
		warnings: {
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
					message: { type: 'string', maxLength: 300 }
				},
				required: ['code', 'message']
			}
		}
	},
	required: ['text', 'warnings']
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
			if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
				return (part as { text: string }).text;
			}
		}
	}
	return null;
}

export async function requestGeminiOcr(request: GeminiOcrRequest): Promise<OcrPayload> {
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
				body: JSON.stringify({
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
						temperature: 0,
						maxOutputTokens: 8192,
						responseFormat: {
							text: { mimeType: 'application/json', schema: responseSchema }
						}
					}
				})
			}
		);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		throw new GeminiTransportError();
	}

	if (!response.ok) throw new GeminiHttpError(response.status, await response.text());

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new GeminiResponseError();
	}
	const text = candidateText(payload);
	if (text === null) throw new GeminiResponseError();
	try {
		return parseOcrPayload(text);
	} catch {
		throw new GeminiResponseError();
	}
}
