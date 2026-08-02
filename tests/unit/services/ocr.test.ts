import { describe, expect, it } from 'vitest';
import {
	OcrProcessingError,
	processPageOcr,
	type OcrFunctionClient
} from '../../../src/lib/services/ocr';

const pageId = '11111111-1111-4111-8111-111111111111';

function client(result: Awaited<ReturnType<OcrFunctionClient['functions']['invoke']>>): OcrFunctionClient {
	return {
		functions: {
			async invoke() {
				return result;
			}
		}
	};
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

	it('maps a permanent provider response to a non-retryable safe error', async () => {
		const response = new Response(
			JSON.stringify({ code: 'gemini_authentication_failed', retryable: false }),
			{ status: 403, headers: { 'Content-Type': 'application/json' } }
		);

		await expect(
			processPageOcr(pageId, client({ data: null, error: { context: response } }))
		).rejects.toEqual(
			expect.objectContaining<OcrProcessingError>({
				code: 'gemini_authentication_failed',
				retryable: false
			})
		);
	});

	it('rejects malformed page identifiers before invoking the backend', async () => {
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
	});
});
