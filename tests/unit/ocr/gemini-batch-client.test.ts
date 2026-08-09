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

function providerResponse(resultPages: unknown[]) {
	return new Response(
		JSON.stringify({
			candidates: [{ content: { parts: [{ text: JSON.stringify({ pages: resultPages }) }] } }]
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

describe('requestGeminiOcrBatch', () => {
	it('labels every inline image with stable page identity and uses a page-keyed schema', async () => {
		let captured: RequestInit | undefined;
		await requestGeminiOcrBatch({
			apiKey: 'test-key',
			model: 'gemini-test',
			pages,
			promptVersion: 2,
			fetchImpl: async (_url, init) => {
				captured = init;
				return providerResponse(
					pages.map((page) => ({
						pageId: page.pageId,
						pageNumber: page.pageNumber,
						text: `Página ${page.pageNumber}`,
						warnings: []
					}))
				);
			}
		});

		const body = JSON.parse(String(captured?.body)) as {
			contents: Array<{
				parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
			}>;
			generationConfig: {
				maxOutputTokens: number;
				responseFormat: {
					text: {
						mimeType: string;
						schema: { required: string[]; properties: { pages: { maxItems: number } } };
					};
				};
			};
		};
		const parts = body.contents[0]!.parts;
		expect(parts[0]?.text).toContain('Versão do prompt: 2.');
		expect(parts[1]?.text).toContain(`${pages[0].pageId}`);
		expect(parts[1]?.text).toContain('página original 4');
		expect(parts[2]?.inlineData).toEqual({ mimeType: 'image/webp', data: 'AQID' });
		expect(parts[3]?.text).toContain(`${pages[1].pageId}`);
		expect(parts[4]?.inlineData).toEqual({ mimeType: 'image/jpeg', data: 'BAU=' });
		expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(8192);
		expect(body.generationConfig.responseFormat.text.mimeType).toBe('application/json');
		expect(body.generationConfig.responseFormat.text.schema.required).toEqual(['pages']);
		expect(body.generationConfig.responseFormat.text.schema.properties.pages.maxItems).toBe(100);
	});

	it('keeps structured-output schema within Gemini supported constraints', async () => {
		let captured: RequestInit | undefined;
		await requestGeminiOcrBatch({
			apiKey: 'test-key',
			model: 'gemini-test',
			pages: [pages[0]],
			promptVersion: 1,
			fetchImpl: async (_url, init) => {
				captured = init;
				return providerResponse([
					{
						pageId: pages[0].pageId,
						pageNumber: pages[0].pageNumber,
						text: 'Página',
						warnings: []
					}
				]);
			}
		});

		const body = JSON.parse(String(captured?.body)) as {
			generationConfig: { responseFormat: { text: { schema: unknown } } };
		};
		const unsupportedKeys = new Set(['minLength', 'maxLength', 'pattern']);
		const found: string[] = [];
		const visit = (value: unknown, path: string) => {
			if (Array.isArray(value)) {
				value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
				return;
			}
			if (value === null || typeof value !== 'object') return;
			for (const [key, child] of Object.entries(value)) {
				if (unsupportedKeys.has(key)) found.push(`${path}.${key}`);
				visit(child, `${path}.${key}`);
			}
		};
		visit(body.generationConfig.responseFormat.text.schema, 'schema');

		expect(found).toEqual([]);
	});

	it('rejects aggregate raw bytes that cannot fit the documented inline request ceiling', async () => {
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
			fetchImpl: async () =>
				providerResponse([
					{
						pageId: pages[0].pageId,
						pageNumber: pages[0].pageNumber,
						text: 'Primeira',
						warnings: []
					}
				])
		});

		expect(outcome.valid).toBe(false);
		expect(outcome.pages.map((page) => page.pageId)).toEqual([pages[0].pageId]);
		expect(outcome.missingPageIds).toEqual([pages[1].pageId]);
	});

	it('rejects duplicate request identities but returns split data for malformed provider text', async () => {
		await expect(
			requestGeminiOcrBatch({
				apiKey: 'test-key',
				model: 'gemini-test',
				pages: [pages[0], { ...pages[1], pageId: pages[0].pageId }],
				promptVersion: 1,
				fetchImpl: async () => providerResponse([])
			})
		).rejects.toBeInstanceOf(TypeError);

		await expect(
			requestGeminiOcrBatch({
				apiKey: 'test-key',
				model: 'gemini-test',
				pages,
				promptVersion: 1,
				fetchImpl: async () =>
					new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{' }] } }] }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					})
			})
		).resolves.toEqual({
			valid: false,
			pages: [],
			missingPageIds: pages.map((page) => page.pageId),
			duplicatePageIds: [],
			unexpectedPageIds: []
		});
	});
});
