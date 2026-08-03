import { describe, expect, it } from 'vitest';
import { processPageOcr, type OcrFunctionClient } from '../../../src/lib/services/ocr';

const pageId = '11111111-1111-4111-8111-111111111111';

function client(response: Response): OcrFunctionClient {
	return {
		functions: {
			async invoke() {
				return { data: null, error: { context: response } };
			}
		}
	};
}

describe('OCR claim rejection HTTP status', () => {
	it('rejects a claim state delivered with the wrong HTTP status', async () => {
		const response = new Response(JSON.stringify({ state: 'consent_required' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' }
		});

		await expect(processPageOcr(pageId, client(response))).rejects.toEqual(
			expect.objectContaining({ code: 'ocr_http_503', retryable: true })
		);
	});
});
