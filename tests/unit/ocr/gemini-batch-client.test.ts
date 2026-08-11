import { describe, expect, it } from 'vitest';
import { requestGeminiOcrBatch } from '../../../supabase/functions/_shared/gemini-ocr-client';

const pages = [
	{
		pageId: '11111111-1111-4111-8111-111111111111',
		pageNumber: 4,
		mimeType: 'image/webp',
		bytes: new Uint8Array([1, 2, 3])
	},
	{
		pageId: '22222222-2222-4222-8222-222222222222',
		pageNumber: 9,
		mimeType: 'image/jpeg',
		bytes: new Uint8Array([4, 5])
	}
] as const;

function pageResult(page: (typeof pages)[number], text = `Página ${page.pageNumber}`) {
	return {
		pageId: page.pageId,
		pageNumber: page.pageNumber,
		text,
		contentClass: 'book_clean',
		lineGeometry: text.trim() ? ['100,100,900,200'] : [],
		warnings: []
	};
}

function providerResponse(resultPages: unknown[], extra: Record<string, unknown> = {}) {
	return new Response(
		JSON.stringify({
			candidates: [{ content: { parts: [{ text: JSON.stringify({ pages: resultPages }) }] } }],
			...extra
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

describe('requestGeminiOcrBatch', () => {
	it('labels images, requests compact line geometry and reserves the full Flash-Lite output ceiling', async () => {
		let captured: RequestInit | undefined;
		await requestGeminiOcrBatch({
			apiKey: 'test-key',
			model: 'gemini-test',
			pages,
			promptVersion: 2,
			fetchImpl: async (_url, init) => {
				captured = init;
				return providerResponse(pages.map((page) => pageResult(page)));
			}
		});

		const body = JSON.parse(String(captured?.body)) as {
			contents: Array<{
				parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
			}>;
			generationConfig: Record<string, unknown>;
		};
		const parts = body.contents[0]!.parts;
		const instruction = parts[0]?.text ?? '';
		expect(instruction).toContain('lineGeometry');
		expect(instruction).toContain('0 a 1000');
		expect(instruction).toContain('Versão do prompt: 2.');
		expect(instruction).not.toContain('wordGeometry');
		expect(parts[1]?.text).toContain(`${pages[0].pageId}`);
		expect(parts[2]?.inlineData).toEqual({ mimeType: 'image/webp', data: 'AQID' });
		expect(parts[3]?.text).toContain(`${pages[1].pageId}`);
		expect(parts[4]?.inlineData).toEqual({ mimeType: 'image/jpeg', data: 'BAU=' });
		expect(body.generationConfig).toEqual({
			maxOutputTokens: 65_536,
			responseMimeType: 'application/json',
			thinkingConfig: { thinkingLevel: 'minimal' }
		});
	});

	it('returns sanitized provider usage metadata without retaining request or response content', async () => {
		const outcome = await requestGeminiOcrBatch({
			apiKey: 'test-key',
			model: 'gemini-test',
			pages: [pages[0]],
			promptVersion: 1,
			fetchImpl: async () =>
				providerResponse([pageResult(pages[0])], {
					usageMetadata: {
						promptTokenCount: 1030,
						cachedContentTokenCount: 0,
						candidatesTokenCount: 212,
						toolUsePromptTokenCount: 0,
						thoughtsTokenCount: 4,
						totalTokenCount: 1246,
						promptTokensDetails: [
							{ modality: 'TEXT', tokenCount: 130 },
							{ modality: 'IMAGE', tokenCount: 900 },
							{ modality: '../../invalid', tokenCount: 999 }
						],
						candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 212 }],
						serviceTier: 'STANDARD'
					},
					modelVersion: 'gemini-test-2026-08',
					responseId: 'response-123'
				})
		});

		expect(outcome.usage).toEqual({
			promptTokenCount: 1030,
			cachedContentTokenCount: 0,
			candidatesTokenCount: 212,
			toolUsePromptTokenCount: 0,
			thoughtsTokenCount: 4,
			totalTokenCount: 1246,
			promptTokensDetails: [
				{ modality: 'TEXT', tokenCount: 130 },
				{ modality: 'IMAGE', tokenCount: 900 }
			],
			cacheTokensDetails: [],
			candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 212 }],
			toolUsePromptTokensDetails: [],
			serviceTier: 'STANDARD'
		});
		expect(outcome.modelVersion).toBe('gemini-test-2026-08');
		expect(outcome.responseId).toBe('response-123');
	});

	it('rejects aggregate raw bytes that cannot fit the inline request ceiling', async () => {
		let called = false;
		await expect(
			requestGeminiOcrBatch({
				apiKey: 'test-key',
				model: 'gemini-test',
				pages: [
					{ ...pages[0], bytes: new Uint8Array(8 * 1024 * 1024) },
					{ ...pages[1], bytes: new Uint8Array(7 * 1024 * 1024) }
				],
				promptVersion: 1,
				fetchImpl: async () => {
					called = true;
					return providerResponse([]);
				}
			})
		).rejects.toThrow('Gemini OCR batch is too large');
		expect(called).toBe(false);
	});

	it('returns valid pages and integrity metadata when the provider omits a page', async () => {
		const outcome = await requestGeminiOcrBatch({
			apiKey: 'test-key',
			model: 'gemini-test',
			pages,
			promptVersion: 1,
			fetchImpl: async () => providerResponse([pageResult(pages[0], 'Primeira')])
		});

		expect(outcome.valid).toBe(false);
		expect(outcome.pages.map((page) => page.pageId)).toEqual([pages[0].pageId]);
		expect(outcome.missingPageIds).toEqual([pages[1].pageId]);
	});

	it('returns split data for malformed provider text', async () => {
		const malformed = await requestGeminiOcrBatch({
			apiKey: 'test-key',
			model: 'gemini-test',
			pages,
			promptVersion: 1,
			fetchImpl: async () =>
				new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{' }] } }] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
		});
		expect(malformed).toMatchObject({
			valid: false,
			pages: [],
			missingPageIds: pages.map((page) => page.pageId),
			duplicatePageIds: [],
			unexpectedPageIds: [],
			usage: null,
			modelVersion: null,
			responseId: null
		});
	});
});
