import { describe, expect, it } from 'vitest';
import { buildGeminiTelemetryRpcArgs } from '../../../supabase/functions/_shared/ocr-provider-telemetry';

const pageId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const batchId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';

const page = {
	pageId,
	pageNumber: 7,
	mimeType: 'image/webp',
	bytes: new Uint8Array(2048)
} as const;

const parsedPage = {
	pageId,
	pageNumber: 7,
	text: 'Texto extraído',
	warnings: [{ code: 'uncertain_text', message: 'Trecho incerto.' }],
	needsReview: true
} as const;

describe('buildGeminiTelemetryRpcArgs', () => {
	it('keeps provider usage and page measurements but not OCR text or image bytes', () => {
		const args = buildGeminiTelemetryRpcArgs({
			eventId,
			documentId,
			batchId,
			model: 'gemini-3.6-flash',
			promptVersion: 3,
			documentKind: 'pdf',
			pages: [page],
			outcome: {
				valid: true,
				pages: [parsedPage],
				missingPageIds: [],
				duplicatePageIds: [],
				unexpectedPageIds: [],
				usage: {
					promptTokenCount: 1000,
					cachedContentTokenCount: 0,
					candidatesTokenCount: 240,
					toolUsePromptTokenCount: 0,
					thoughtsTokenCount: 50,
					totalTokenCount: 1290,
					promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 900 }],
					cacheTokensDetails: [],
					candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 240 }],
					toolUsePromptTokensDetails: [],
					serviceTier: 'STANDARD'
				},
				modelVersion: 'gemini-3.6-flash-2026-08',
				responseId: 'provider-response-id'
			},
			status: 'success',
			safeErrorCode: null,
			latencyMs: 1234.7,
			recordedAt: '2026-08-10T10:30:00.000Z'
		});

		expect(args.target_prompt_token_count).toBe(1000);
		expect(args.target_candidates_token_count).toBe(240);
		expect(args.target_thoughts_token_count).toBe(50);
		expect(args.target_total_token_count).toBe(1290);
		expect(args.target_latency_ms).toBe(1235);
		expect(args.target_page_metrics).toEqual([
			{
				pageId,
				pageNumber: 7,
				sourceBytes: 2048,
				outputCharacters: parsedPage.text.length,
				warningCount: 1,
				needsReview: true,
				contentClass: 'unknown',
				routeReason: 'primary_gemini',
				shadowSample: false
			}
		]);
		const serialized = JSON.stringify(args);
		expect(serialized).not.toContain('Texto extraído');
		expect(serialized).not.toContain('Trecho incerto');
		expect(serialized).not.toContain('apiKey');
		expect(serialized).not.toContain('inlineData');
	});

	it('records failed provider calls without inventing token usage', () => {
		const args = buildGeminiTelemetryRpcArgs({
			eventId,
			documentId,
			batchId: null,
			model: 'gemini-3.6-flash',
			promptVersion: 1,
			documentKind: 'image',
			pages: [page],
			outcome: null,
			status: 'error',
			safeErrorCode: 'ocr_quota_exhausted',
			latencyMs: 80,
			recordedAt: '2026-08-10T10:30:00.000Z'
		});

		expect(args.terminal_status).toBe('error');
		expect(args.target_safe_error_code).toBe('ocr_quota_exhausted');
		expect(args.target_total_token_count).toBeNull();
		expect(args.target_page_metrics[0]).toMatchObject({
			outputCharacters: 0,
			warningCount: 0,
			needsReview: false
		});
	});

	it('accepts future content classes and shadow-sampling flags explicitly', () => {
		const args = buildGeminiTelemetryRpcArgs({
			eventId,
			documentId,
			batchId,
			model: 'gemini-3.6-flash',
			promptVersion: 1,
			documentKind: 'pdf',
			pages: [page],
			outcome: null,
			status: 'error',
			safeErrorCode: 'ocr_request_failed',
			latencyMs: 1,
			recordedAt: '2026-08-10T10:30:00.000Z',
			contentClasses: new Map([[pageId, 'handwriting']]),
			routeReason: 'shadow_evaluation',
			shadowSamplePageIds: new Set([pageId])
		});

		expect(args.target_page_metrics[0]).toMatchObject({
			contentClass: 'handwriting',
			routeReason: 'shadow_evaluation',
			shadowSample: true
		});
	});
});
