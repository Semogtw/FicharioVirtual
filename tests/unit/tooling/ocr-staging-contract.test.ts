import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	assertOcrInvocation,
	assertOcrPersistence,
	createOcrInvocationDiagnostic,
	createOcrProbePng,
	createOcrStagingReport,
	formatOcrInvocationFailure,
	normalizeOcrProbeText
} from '../../../tools/checks/ocr-staging-contract.mjs';

const pageId = '11111111-1111-4111-8111-111111111111';

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

describe('OCR staging contract', () => {
	it('generates deterministic readable PNG bytes with nonce-specific identity', () => {
		const first = createOcrProbePng('probe-aaaaaaaa');
		const repeated = createOcrProbePng('probe-aaaaaaaa');
		const second = createOcrProbePng('probe-bbbbbbbb');
		const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

		expect(Array.from(first.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		expect(first.byteLength).toBeGreaterThan(500);
		expect(digest(first)).toBe(digest(repeated));
		expect(digest(first)).not.toBe(digest(second));
	});

	it('creates a machine-readable report from allowlisted launch fields only', () => {
		const report = createOcrStagingReport({
			status: 'pass',
			failureStage: null,
			stages: {
				authenticated: true,
				authorized: true,
				probeCreated: true,
				functionCompleted: true,
				persistenceVerified: true
			},
			outcome: {
				documentStatus: 'ready',
				pageStatus: 'ready',
				jobStatus: 'ready',
				needsReview: false,
				warningCount: 0,
				attemptCount: 1,
				tokens: { fichario: true, ocr: true, numericProbe: true }
			},
			diagnostic: {
				httpStatus: null,
				errorKind: null,
				providerStatus: null,
				providerErrorKind: null,
				providerErrorCode: null
			},
			cleanup: { document: 'success', session: 'success' }
		});

		expect(report).toEqual({
			schemaVersion: 3,
			status: 'pass',
			failureStage: null,
			stages: {
				authenticated: true,
				authorized: true,
				probeCreated: true,
				functionCompleted: true,
				persistenceVerified: true
			},
			outcome: {
				documentStatus: 'ready',
				pageStatus: 'ready',
				jobStatus: 'ready',
				needsReview: false,
				warningCount: 0,
				attemptCount: 1,
				tokens: { fichario: true, ocr: true, numericProbe: true }
			},
			providerAttempts: [],
			diagnostic: {
				httpStatus: null,
				errorKind: null,
				providerStatus: null,
				providerErrorKind: null,
				providerErrorCode: null,
				runtimeErrorCode: null
			},
			cleanup: { document: 'success', session: 'success' }
		});
		const serialized = JSON.stringify(report);
		for (const forbidden of [
			'email',
			'userId',
			'documentId',
			'pageId',
			'jobId',
			'url',
			'path',
			'transcript',
			'errorMessage',
			'consent'
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	it('preserves only sanitized provider routing attempts for fallback diagnosis', () => {
		const report = createOcrStagingReport({
			status: 'fail',
			failureStage: 'invocation',
			stages: {
				authenticated: true,
				authorized: true,
				probeCreated: true,
				functionCompleted: false,
				persistenceVerified: false
			},
			outcome: {
				documentStatus: null,
				pageStatus: null,
				jobStatus: null,
				needsReview: null,
				warningCount: null,
				attemptCount: null,
				tokens: { fichario: null, ocr: null, numericProbe: null }
			},
			providerAttempts: [
				{
					model: 'gemini-3.1-flash-lite',
					status: 'error',
					safeErrorCode: 'gemini_daily_quota',
					routeReason: 'primary_gemini'
				},
				{
					model: 'gemini-3.5-flash-lite',
					status: 'error',
					safeErrorCode: 'gemini_daily_quota',
					routeReason: 'fallback_gemini_rate_limit'
				}
			],
			diagnostic: {},
			cleanup: { document: 'success', session: 'success' }
		});

		expect(report.providerAttempts).toEqual([
			{
				model: 'gemini-3.1-flash-lite',
				status: 'error',
				safeErrorCode: 'gemini_daily_quota',
				routeReason: 'primary_gemini'
			},
			{
				model: 'gemini-3.5-flash-lite',
				status: 'error',
				safeErrorCode: 'gemini_daily_quota',
				routeReason: 'fallback_gemini_rate_limit'
			}
		]);
		expect(JSON.stringify(report)).not.toContain('provider secret');
	});

	it('drops an unrecognized failure stage instead of serializing arbitrary text', () => {
		const report = createOcrStagingReport({
			status: 'fail',
			failureStage: 'https://secret.example/raw-provider-error' as never,
			stages: {
				authenticated: false,
				authorized: false,
				probeCreated: false,
				functionCompleted: false,
				persistenceVerified: false
			},
			outcome: {
				documentStatus: null,
				pageStatus: null,
				jobStatus: null,
				needsReview: null,
				warningCount: null,
				attemptCount: null,
				tokens: { fichario: null, ocr: null, numericProbe: null }
			},
			diagnostic: {
				httpStatus: null,
				errorKind: null,
				providerStatus: null,
				providerErrorKind: null,
				providerErrorCode: null
			},
			cleanup: { document: 'not_required', session: 'not_required' }
		});

		expect(report.failureStage).toBeNull();
		expect(JSON.stringify(report)).not.toContain('secret.example');
	});

	it('records only safe provider classification from a non-2xx body', async () => {
		const diagnostic = await createOcrInvocationDiagnostic({
			error: { name: 'FunctionsHttpError' },
			response: new Response(
				JSON.stringify({
					code: 'gemini_invalid_request',
					message: 'provider secret https://secret.example/raw body'
				}),
				{ status: 400, headers: { 'content-type': 'application/json' } }
			)
		});

		expect(diagnostic).toEqual({
			httpStatus: 400,
			errorKind: 'FunctionsHttpError',
			providerStatus: 400,
			providerErrorKind: 'invalid_request',
			providerErrorCode: 'gemini_invalid_request'
		});
		expect(formatOcrInvocationFailure(diagnostic)).toBe(
			'process-ocr failed: HTTP 400 (FunctionsHttpError); provider=invalid_request/gemini_invalid_request'
		);
		expect(
			await createOcrInvocationDiagnostic({
				error: { name: 'UnexpectedProviderError' },
				response: new Response(JSON.stringify({ code: 'raw-secret-code' }), { status: 400 })
			})
		).toEqual({
			httpStatus: 400,
			errorKind: null,
			providerStatus: null,
			providerErrorKind: null,
			providerErrorCode: null
		});
		expect(JSON.stringify(diagnostic)).not.toContain('secret.example');
	});

	it('normalizes accents and punctuation before token checks', () => {
		expect(normalizeOcrProbeText('FICHÁRIO — OCR: 2718')).toBe('fichario ocr 2718');
		expect(normalizeOcrProbeText(null)).toBe('');
	});

	it('requires the aggregate launch Edge Function response', () => {
		expect(assertOcrInvocation({ data: aggregate(), pageId })).toEqual({ needsReview: false });
		expect(assertOcrInvocation({ data: aggregate({ reviewPageIds: [pageId] }), pageId })).toEqual({
			needsReview: true
		});
		expect(() =>
			assertOcrInvocation({
				data: aggregate({
					state: 'partial',
					completedPageIds: [],
					pendingPageIds: [pageId]
				}),
				pageId
			})
		).toThrow(/unexpected function state/);
	});

	it('rejects the removed single-page response envelope', () => {
		expect(() =>
			assertOcrInvocation({
				data: { state: 'complete', needsReview: false, warningCount: 0 },
				pageId
			})
		).toThrow(/unexpected function state/);
	});

	it('requires aligned terminal rows and the synthetic transcript tokens', () => {
		const document = { status: 'ready' };
		const page = {
			status: 'ready',
			extraction_source: 'ocr',
			ocr_raw_text: 'Fichário OCR 2718',
			warnings: []
		};
		const job = {
			status: 'ready',
			attempt_count: 1,
			last_error_code: null,
			finished_at: '2026-08-03T01:00:00.000Z'
		};

		expect(() => assertOcrPersistence({ document, page, job })).not.toThrow();
		expect(() =>
			assertOcrPersistence({ document, page: { ...page, ocr_raw_text: 'unrelated text' }, job })
		).toThrow(/missing token/);
		expect(() =>
			assertOcrPersistence({ document, page, job: { ...job, status: 'processing' } })
		).toThrow(/states diverged/);
	});
});
