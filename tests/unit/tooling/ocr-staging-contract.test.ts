import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	assertOcrInvocation,
	assertOcrPersistence,
	createOcrProbePng,
	createOcrStagingReport,
	normalizeOcrProbeText
} from '../../../tools/checks/ocr-staging-contract.mjs';

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

	it('creates a machine-readable report from allowlisted fields only', () => {
		const report = createOcrStagingReport({
			status: 'pass',
			failureStage: null,
			stages: {
				authenticated: true,
				authorized: true,
				consentRecorded: true,
				importCreated: true,
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
			cleanup: { document: 'success', session: 'success' }
		});

		expect(report).toEqual({
			schemaVersion: 1,
			status: 'pass',
			failureStage: null,
			stages: {
				authenticated: true,
				authorized: true,
				consentRecorded: true,
				importCreated: true,
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
			'errorMessage'
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	it('drops an unrecognized failure stage instead of serializing arbitrary text', () => {
		const report = createOcrStagingReport({
			status: 'fail',
			failureStage: 'https://secret.example/raw-provider-error' as never,
			stages: {
				authenticated: false,
				authorized: false,
				consentRecorded: false,
				importCreated: false,
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
			cleanup: { document: 'not_required', session: 'not_required' }
		});

		expect(report.failureStage).toBeNull();
		expect(JSON.stringify(report)).not.toContain('secret.example');
	});

	it('normalizes accents and punctuation before token checks', () => {
		expect(normalizeOcrProbeText('FICHÁRIO — OCR: 2718')).toBe('fichario ocr 2718');
		expect(normalizeOcrProbeText(null)).toBe('');
	});

	it('requires a completed Edge Function response', () => {
		expect(() =>
			assertOcrInvocation({ data: { state: 'complete', needsReview: false, warningCount: 0 } })
		).not.toThrow();
		expect(() =>
			assertOcrInvocation({ data: { state: 'retry_later', needsReview: false, warningCount: 0 } })
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
