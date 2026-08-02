import { describe, expect, it } from 'vitest';
import {
	OcrProcessingError,
	processPageOcr,
	type OcrFunctionClient
} from '../../../src/lib/services/ocr';

const pageId = '11111111-1111-4111-8111-111111111111';

describe('processPageOcr', () => {
	it('returns the strict completion result from the Edge Function', async () => {
		const client: OcrFunctionClient = {
			functions: {
				async invoke() {
					return {
						data: { state: 'complete', needsReview: true, warningCount: 2 },
						error: null
					};
				}
			}
		};

		await expect(processPageOcr(pageId, client)).resolves.toEqual({
			state: 'complete',
			needsReview: true,
			warningCount: 2
		});
	});

	it('maps a quota response to a non-retryable safe error', async () => {
		const client: OcrFunctionClient = {
			functions: {
				async invoke() {
					return {
						data: null,
						error: {
							context: new Response(JSON.stringify({ code: 'gemini_daily_quota' }), {
								status: 429,
								headers: { 'Content-Type': 'application/json' }
							})
						}
					};
				}
			}
		};

		await expect(processPageOcr(pageId, client)).rejects.toEqual(
			expect.objectContaining<OcrProcessingError>({
				code: 'gemini_daily_quota',
				retryable: false
			})
		);
	});

	it('rejects malformed page identifiers before invoking the backend', async () => {
		let invoked = false;
		const client: OcrFunctionClient = {
			functions: {
				async invoke() {
					invoked = true;
					return { data: null, error: null };
				}
			}
		};

		await expect(processPageOcr('bad-id', client)).rejects.toThrow('Invalid page identifier');
		expect(invoked).toBe(false);
	});
});
