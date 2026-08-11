import { describe, expect, it, vi } from 'vitest';
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

function aggregate(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		state: 'complete',
		completedPageIds: [pageId],
		reviewPageIds: [],
		pendingPageIds: [],
		failedPageIds: [],
		splitRequiredPageIds: [],
		unexpectedResultPageIds: [],
		...overrides
	};
}

function errorResponse(status: number, body: Record<string, unknown>) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('processPageOcr', () => {
	it('derives the page completion result from the aggregate launch contract', async () => {
		await expect(
			processPageOcr(pageId, client({ data: aggregate({ reviewPageIds: [pageId] }), error: null }))
		).resolves.toEqual({ state: 'complete', needsReview: true });
	});

	it('derives a deferred page result from the aggregate launch contract', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({
					data: aggregate({
						state: 'partial',
						completedPageIds: [],
						pendingPageIds: [pageId]
					}),
					error: null
				})
			)
		).resolves.toEqual({ state: 'retry_later' });
	});

	it('treats an aggregate terminal page as non-retryable', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({
					data: aggregate({
						state: 'partial',
						completedPageIds: [],
						failedPageIds: [pageId]
					}),
					error: null
				})
			)
		).rejects.toEqual(expect.objectContaining({ code: 'ocr_not_retryable', retryable: false }));
	});

	it.each([
		{ state: 'complete', needsReview: true, warningCount: 2 },
		{ state: 'already_complete', needsReview: true },
		{ state: 'busy' },
		{ state: 'retry_later' },
		{ state: 'quota_exhausted' }
	])('rejects pre-launch single-page response envelope %#', async (data) => {
		await expect(processPageOcr(pageId, client({ data, error: null }))).rejects.toEqual(
			expect.objectContaining({ code: 'ocr_response_invalid', retryable: true })
		);
	});

	it('invokes the Edge Function with the launch pageIds body even for one page', async () => {
		const invoke = vi.fn(async () => ({ data: aggregate(), error: null }));
		const gateway: OcrFunctionClient = { functions: { invoke } };

		await processPageOcr(pageId, gateway);

		expect(invoke).toHaveBeenCalledWith('process-ocr', {
			body: { pageIds: [pageId] },
			signal: undefined
		});
	});

	it('treats transport failures without an HTTP response as retryable', async () => {
		await expect(
			processPageOcr(pageId, client({ data: null, error: { message: 'Failed to fetch' } }))
		).rejects.toEqual(expect.objectContaining({ code: 'ocr_transport_failed', retryable: true }));
	});

	it.each([
		[403, 'not_authorized', 'ocr_not_authorized'],
		[404, 'not_found', 'ocr_page_not_found'],
		[409, 'invalid_configuration', 'ocr_not_configured'],
		[409, 'not_retryable', 'ocr_not_retryable']
	] as const)('maps claim state %s/%s to the safe domain error %s', async (status, state, code) => {
		await expect(
			processPageOcr(
				pageId,
				client({ data: null, error: { context: errorResponse(status, { state }) } })
			)
		).rejects.toEqual(expect.objectContaining({ code, retryable: false }));
	});

	it('does not recognize removed consent claim states', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({
					data: null,
					error: { context: errorResponse(403, { state: 'consent_required' }) }
				})
			)
		).rejects.toEqual(expect.objectContaining({ code: 'ocr_http_403', retryable: false }));
	});

	it('does not trust a claim state response with undeclared fields', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({
					data: null,
					error: {
						context: errorResponse(403, {
							state: 'not_authorized',
							retryable: true
						})
					}
				})
			)
		).rejects.toEqual(expect.objectContaining({ code: 'ocr_http_403', retryable: false }));
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

	it('ignores malformed or extended provider error envelopes', async () => {
		await expect(
			processPageOcr(
				pageId,
				client({
					data: null,
					error: {
						context: errorResponse(403, {
							code: 'gemini_authentication_failed',
							retryable: false,
							detail: 'secret provider response'
						})
					}
				})
			)
		).rejects.toEqual(expect.objectContaining({ code: 'ocr_http_403', retryable: false }));

		await expect(
			processPageOcr(
				pageId,
				client({
					data: null,
					error: {
						context: errorResponse(503, { code: '../invalid', retryable: false })
					}
				})
			)
		).rejects.toEqual(expect.objectContaining({ code: 'ocr_http_503', retryable: true }));
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
