import { describe, expect, it } from 'vitest';
import {
	GeminiResponseError,
	GeminiTransportError,
	requestGeminiOcr
} from '../../../supabase/functions/_shared/gemini-ocr-client';

const input = {
	apiKey: 'test-key',
	model: 'gemini-test',
	mimeType: 'image/webp',
	bytes: new Uint8Array([1, 2, 3]),
	promptVersion: 1
};

function validProviderResponse() {
	return {
		candidates: [
			{
				content: {
					parts: [{ text: JSON.stringify({ text: 'Transcrição', warnings: [] }) }]
				}
			}
		]
	};
}

describe('requestGeminiOcr', () => {
	it('sends the image and strict prompt contract without putting the API key in the URL', async () => {
		let capturedUrl = '';
		let capturedInit: RequestInit | undefined;

		await requestGeminiOcr({
			...input,
			model: 'gemini/test model',
			fetchImpl: async (url, init) => {
				capturedUrl = String(url);
				capturedInit = init;
				return new Response(JSON.stringify(validProviderResponse()), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
		});

		expect(capturedUrl).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini%2Ftest%20model:generateContent'
		);
		expect(capturedUrl).not.toContain(input.apiKey);
		expect(new Headers(capturedInit?.headers).get('x-goog-api-key')).toBe(input.apiKey);

		const body = JSON.parse(String(capturedInit?.body)) as {
			contents: Array<{
				parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }>;
			}>;
			generationConfig: {
				maxOutputTokens: number;
				responseMimeType: string;
				[key: string]: unknown;
			};
		};
		expect(body.contents[0]?.parts[0]?.inlineData).toEqual({
			mimeType: 'image/webp',
			data: 'AQID'
		});
		expect(body.contents[0]?.parts[1]?.text).toContain('Contrato JSON obrigatório');
		expect(body.contents[0]?.parts[1]?.text).toContain('"required":["text","warnings"]');
		expect(body.contents[0]?.parts[1]?.text).toContain('Versão do prompt: 1.');
		expect(body.generationConfig).not.toHaveProperty('temperature');
		expect(body.generationConfig).not.toHaveProperty('topP');
		expect(body.generationConfig).not.toHaveProperty('topK');
		expect(body.generationConfig).toEqual({
			maxOutputTokens: 8192,
			responseMimeType: 'application/json'
		});
		expect(body.generationConfig).not.toHaveProperty('responseFormat');
		expect(body.generationConfig).not.toHaveProperty('responseJsonSchema');
		expect(body.generationConfig).not.toHaveProperty('responseSchema');
	});

	it('classifies a rejected fetch as a transport failure', async () => {
		await expect(
			requestGeminiOcr({
				...input,
				fetchImpl: async () => {
					throw new TypeError('network down');
				}
			})
		).rejects.toBeInstanceOf(GeminiTransportError);
	});

	it('preserves non-success HTTP status for quota classification', async () => {
		await expect(
			requestGeminiOcr({
				...input,
				fetchImpl: async () => new Response('Rate limit exceeded', { status: 429 })
			})
		).rejects.toEqual(expect.objectContaining({ status: 429 }));
	});

	it('classifies malformed successful payloads separately from transport errors', async () => {
		await expect(
			requestGeminiOcr({
				...input,
				fetchImpl: async () => new Response('{', { status: 200 })
			})
		).rejects.toBeInstanceOf(GeminiResponseError);
	});

	it('returns the validated OCR contract from a structured candidate', async () => {
		await expect(
			requestGeminiOcr({
				...input,
				fetchImpl: async () =>
					new Response(JSON.stringify(validProviderResponse()), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
			})
		).resolves.toEqual({ text: 'Transcrição', warnings: [], needsReview: false });
	});
});
