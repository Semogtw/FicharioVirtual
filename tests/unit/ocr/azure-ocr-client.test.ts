import { describe, expect, it } from 'vitest';
import {
	AzureOcrEligibilityError,
	AzureOcrHttpError,
	AzureOcrOperationFailedError,
	AzureOcrResponseError,
	createAzureOcrProvider
} from '../../../supabase/functions/_shared/azure-ocr-client';

const ENDPOINT = 'https://fichario-test.cognitiveservices.azure.com';
const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';

function page(bytes = new Uint8Array([1, 2, 3]), mimeType = 'image/jpeg') {
	return {
		pageId: PAGE_ID,
		pageNumber: 2,
		mimeType,
		bytes
	};
}

function succeededBody() {
	return {
		status: 'succeeded',
		analyzeResult: {
			version: '3.2.0',
			readResults: [
				{
					width: 100,
					height: 100,
					lines: [
						{
							text: 'Arquivo público',
							words: [
								{
									text: 'Arquivo',
									boundingBox: [10, 10, 40, 10, 40, 20, 10, 20],
									confidence: 0.99
								},
								{
									text: 'público',
									boundingBox: [45, 10, 90, 10, 90, 20, 45, 20],
									confidence: 0.98
								}
							]
						}
					]
				}
			]
		}
	};
}

function immediateSleep() {
	return Promise.resolve();
}

describe('Azure OCR provider client', () => {
	it('submits one image, reconstructs the polling URL and returns the neutral contract', async () => {
		const calls: Array<{ input: string; init: RequestInit }> = [];
		const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
			calls.push({ input: String(input), init: init ?? {} });
			if (calls.length === 1) {
				return new Response(null, {
					status: 202,
					headers: {
						'Operation-Location': `${ENDPOINT}/vision/v3.2/read/analyzeResults/${OPERATION_ID}`
					}
				});
			}
			return new Response(JSON.stringify(succeededBody()), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}) as typeof fetch;
		const provider = createAzureOcrProvider({
			endpoint: ENDPOINT,
			apiKey: 'azure-test-key',
			fetchImpl,
			sleepImpl: immediateSleep
		});

		const outcome = await provider.requestBatch({
			model: 'read-v3.2',
			promptVersion: 1,
			pages: [page()]
		});

		expect(provider.id).toBe('azure_vision');
		expect(calls.map((call) => call.input)).toEqual([
			`${ENDPOINT}/vision/v3.2/read/analyze`,
			`${ENDPOINT}/vision/v3.2/read/analyzeResults/${OPERATION_ID}`
		]);
		expect(calls[0]?.init).toEqual(expect.objectContaining({ method: 'POST', redirect: 'error' }));
		expect(calls[1]?.init).toEqual(expect.objectContaining({ method: 'GET', redirect: 'error' }));
		expect(outcome).toEqual(
			expect.objectContaining({
				valid: true,
				provider: 'azure_vision',
				model: 'read-v3.2',
				providerModelVersion: '3.2.0',
				providerResponseId: OPERATION_ID,
				usage: {
					requestCount: 1,
					inputTokens: null,
					outputTokens: null,
					totalTokens: null
				}
			})
		);
		expect(outcome.pages[0]?.text).toBe('Arquivo público');
	});

	it('never follows an Operation-Location on another origin', async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return new Response(null, {
				status: 202,
				headers: {
					'Operation-Location': `https://attacker.example/vision/v3.2/read/analyzeResults/${OPERATION_ID}`
				}
			});
		}) as typeof fetch;
		const provider = createAzureOcrProvider({
			endpoint: ENDPOINT,
			apiKey: 'azure-test-key',
			fetchImpl,
			sleepImpl: immediateSleep
		});

		await expect(
			provider.requestBatch({ model: 'read-v3.2', promptVersion: 1, pages: [page()] })
		).rejects.toBeInstanceOf(AzureOcrResponseError);
		expect(calls).toBe(1);
	});

	it('rejects unsupported formats, oversized pages and batching before network access', async () => {
		const fetchImpl = (async () => {
			throw new Error('must not be called');
		}) as typeof fetch;
		const provider = createAzureOcrProvider({
			endpoint: ENDPOINT,
			apiKey: 'azure-test-key',
			maxImageBytes: 3,
			fetchImpl,
			sleepImpl: immediateSleep
		});

		await expect(
			provider.requestBatch({
				model: 'read-v3.2',
				promptVersion: 1,
				pages: [page(undefined, 'image/webp')]
			})
		).rejects.toBeInstanceOf(AzureOcrEligibilityError);
		await expect(
			provider.requestBatch({
				model: 'read-v3.2',
				promptVersion: 1,
				pages: [page(new Uint8Array([1, 2, 3, 4]))]
			})
		).rejects.toBeInstanceOf(AzureOcrEligibilityError);
		await expect(
			provider.requestBatch({
				model: 'read-v3.2',
				promptVersion: 1,
				pages: [page(), { ...page(), pageId: '33333333-3333-4333-8333-333333333333' }]
			})
		).rejects.toBeInstanceOf(AzureOcrEligibilityError);
	});

	it('surfaces HTTP and operation failures as typed provider errors', async () => {
		const httpProvider = createAzureOcrProvider({
			endpoint: ENDPOINT,
			apiKey: 'azure-test-key',
			fetchImpl: (async () => new Response(null, { status: 429 })) as typeof fetch,
			sleepImpl: immediateSleep
		});
		await expect(
			httpProvider.requestBatch({ model: 'read-v3.2', promptVersion: 1, pages: [page()] })
		).rejects.toEqual(expect.objectContaining<Partial<AzureOcrHttpError>>({ status: 429 }));

		let call = 0;
		const failedProvider = createAzureOcrProvider({
			endpoint: ENDPOINT,
			apiKey: 'azure-test-key',
			fetchImpl: (async () => {
				call += 1;
				if (call === 1) {
					return new Response(null, {
						status: 202,
						headers: {
							'Operation-Location': `${ENDPOINT}/vision/v3.2/read/analyzeResults/${OPERATION_ID}`
						}
					});
				}
				return new Response(JSON.stringify({ status: 'failed' }), { status: 200 });
			}) as typeof fetch,
			sleepImpl: immediateSleep
		});
		await expect(
			failedProvider.requestBatch({ model: 'read-v3.2', promptVersion: 1, pages: [page()] })
		).rejects.toBeInstanceOf(AzureOcrOperationFailedError);
	});

	it('rejects non-Azure endpoints at provider construction', () => {
		expect(() =>
			createAzureOcrProvider({ endpoint: 'https://example.com', apiKey: 'key' })
		).toThrow(TypeError);
		expect(() =>
			createAzureOcrProvider({
				endpoint: 'http://westus.api.cognitive.microsoft.com',
				apiKey: 'key'
			})
		).toThrow(TypeError);
	});
});
