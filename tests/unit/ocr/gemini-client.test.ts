import { describe, expect, it } from 'vitest';
import {
	GeminiHttpError,
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

describe('requestGeminiOcr', () => {
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
		).rejects.toEqual(expect.objectContaining<GeminiHttpError>({ status: 429 }));
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
		const payload = {
			candidates: [
				{
					content: {
						parts: [{ text: JSON.stringify({ text: 'Transcrição', warnings: [] }) }]
					}
				}
			]
		};
		await expect(
			requestGeminiOcr({
				...input,
				fetchImpl: async () =>
					new Response(JSON.stringify(payload), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
			})
		).resolves.toEqual({ text: 'Transcrição', warnings: [], needsReview: false });
	});
});
