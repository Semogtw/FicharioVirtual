import { describe, expect, it } from 'vitest';
import { processPageOcr, type OcrFunctionClient } from '../../../src/lib/services/ocr';

const pageId = '11111111-1111-4111-8111-111111111111';

function client(
	result: Awaited<ReturnType<OcrFunctionClient['functions']['invoke']>>
): OcrFunctionClient {
	return {
		functions: {
			async invoke() {
				return result;
			}
		}
	};
}

function errorResponse(status: number, body: Record<string, unknown>) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('processPageOcr', () => {
	it('returns the strict completion result from the Edge Function', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({
					data: { state: 'complete', needsReview: true, warningCount: 2 },
					error: null
				})
			)
		).resolves.toEqual({
			state: 'complete',
			needsReview: true,
			warningCount: 2
		});
	});

	it('returns deferred retry and quota states without treating them as failures', async () => {
		await expect(
			processPageOcr(pageId, client({ data: { state: 'retry_later' }, error: null }))
		).resolves.toEqual({ state: 'retry_later' });
		await expect(
			processPageOcr(pageId, client({ data: { state: 'quota_exhausted' }, error: null }))
		).resolves.toEqual({ state: 'quota_exhausted' });
	});

	it('rejects completion responses with undeclared fields', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({
					data: {
						state: 'complete',
						needsReview: false,
						warningCount: 0,
						jobId: pageId
					},
					error: null
				})
			)
		).rejects.toEqual(
			expect.objectContaining({ code: 'ocr_response_invalid', retryable: true })
		);
	});

	it('rejects deferred states with undeclared fields', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({ data: { state: 'busy', jobId: pageId }, error: null })
			)
		).rejects.toEqual(
			expect.objectContaining({ code: 'ocr_response_invalid', retryable: true })
		);
	});

	it('rejects warning counts beyond the provider response contract', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({
					data: { state: 'complete', needsReview: true, warningCount: 101 },
					error: null
				})
			)
		).rejects.toEqual(
			expect.objectContaining({ code: 'ocr_response_invalid', retryable: true })
		);
	});

	it('treats transport failures without an HTTP response as retryable', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({ data: null, error: { message: 'Failed to fetch' } })
			)
		).rejects.toEqual(
			expect.objectContaining({ code: 'ocr_transport_failed', retryable: true })
		);
	});

	it.each([
		[403, 'consent_required', 'ocr_consent_required'],
		[403, 'not_authorized', 'ocr_not_authorized'],
		[404, 'not_found', 'ocr_page_not_found'],
		[409, 'invalid_configuration', 'ocr_not_configured'],
		[409, 'not_retryable', 'ocr_not_retryable']
	] as const)(
		'maps claim state %s/%s to the safe domain error %s',
		async (status, state, code) => {
			await expect(
				processPageOcr(
					pageId,
					client({ data: null, error: { context: errorResponse(status, { state }) } })
				)
			).rejects.toEqual(expect.objectContaining({ code, retryable: false }));
		}
	);

	it('does not trust a claim state response with undeclared fields', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({
					data: null,
					error: {
						context: errorResponse(403, {
							state: 'consent_required',
							retryable: true
						})
					}
				})
			)
		).rejects.toEqual(expect.objectContaining({ code: 'ocr_http_403', retryable: true }));
	});

	it('maps a permanent provider response to a non-retryable safe error', async () => {
		const response = errorResponse(403, {
			code: 'gemini_authentication_failed',
			retryable: false
		});

		await expect(
			processPageOcr(pageId, client({ data: null, error: { context: response } }))
		).rejects.toEqual(
			expect.objectContaining({
				code: 'gemini_authentication_failed',
				retryable: false
			})
		);
	});

	it('rejects malformed page identifiers before invoking or constructing the backend client', async () => {
		let invoked = false;
		const invalidClient: OcrFunctionClient = {
			functions: {
				async invoke() {
					invoked = true;
					return { data: null, error: null };
				}
			}
		};

		await expect(processPageOcr('bad-id', invalidClient)).rejects.toThrow(
			'Invalid page identifier'
		);
		expect(invoked).toBe(false);
		await expect(processPageOcr('bad-id')).rejects.toThrow('Invalid page identifier');
	});
});
