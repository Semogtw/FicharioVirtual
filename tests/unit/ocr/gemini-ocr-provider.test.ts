import { describe, expect, it } from 'vitest';
import type { GeminiOcrBatchRequest } from '../../../supabase/functions/_shared/gemini-ocr-client';
import { createGeminiOcrProvider } from '../../../supabase/functions/_shared/gemini-ocr-provider';

const PAGE_ID = '11111111-1111-4111-8111-111111111111';

describe('Gemini OCR provider adapter', () => {
	it('keeps secrets in provider configuration and normalizes metadata', async () => {
		let captured: GeminiOcrBatchRequest | null = null;
		const provider = createGeminiOcrProvider({
			apiKey: 'server-only-key',
			async requestImpl(request) {
				captured = request;
				return {
					valid: false,
					pages: [],
					missingPageIds: [PAGE_ID],
					duplicatePageIds: [],
					unexpectedPageIds: [],
					usage: {
						promptTokenCount: 120,
						cachedContentTokenCount: null,
						candidatesTokenCount: 40,
						toolUsePromptTokenCount: null,
						thoughtsTokenCount: null,
						totalTokenCount: 160,
						promptTokensDetails: [],
						cacheTokensDetails: [],
						candidatesTokensDetails: [],
						toolUsePromptTokensDetails: [],
						serviceTier: null
					},
					modelVersion: 'gemini-test-version',
					responseId: 'response-1'
				};
			}
		});

		const outcome = await provider.requestBatch({
			model: 'gemini-test',
			promptVersion: 7,
			pages: [
				{
					pageId: PAGE_ID,
					pageNumber: 1,
					mimeType: 'image/jpeg',
					bytes: new Uint8Array([1, 2, 3])
				}
			]
		});

		expect(provider.id).toBe('gemini');
		expect(captured).toEqual(
			expect.objectContaining({
				apiKey: 'server-only-key',
				model: 'gemini-test',
				promptVersion: 7
			})
		);
		expect(outcome).toEqual({
			valid: false,
			pages: [],
			missingPageIds: [PAGE_ID],
			duplicatePageIds: [],
			unexpectedPageIds: [],
			provider: 'gemini',
			model: 'gemini-test',
			providerModelVersion: 'gemini-test-version',
			providerResponseId: 'response-1',
			usage: {
				requestCount: 1,
				inputTokens: 120,
				outputTokens: 40,
				totalTokens: 160
			}
		});
	});

	it('preserves null usage without inventing provider metrics', async () => {
		const provider = createGeminiOcrProvider({
			apiKey: 'server-only-key',
			async requestImpl() {
				return {
					valid: false,
					pages: [],
					missingPageIds: [PAGE_ID],
					duplicatePageIds: [],
					unexpectedPageIds: [],
					usage: null,
					modelVersion: null,
					responseId: null
				};
			}
		});

		const outcome = await provider.requestBatch({
			model: 'gemini-test',
			promptVersion: 1,
			pages: [
				{
					pageId: PAGE_ID,
					pageNumber: 1,
					mimeType: 'image/png',
					bytes: new Uint8Array([1])
				}
			]
		});

		expect(outcome.usage).toBeNull();
	});
});
