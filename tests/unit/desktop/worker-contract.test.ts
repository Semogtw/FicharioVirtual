import { describe, expect, it } from 'vitest';
import { parseDesktopWorkerRequest } from '../../../supabase/functions/_shared/desktop-worker-contract';

const jobId = '11111111-1111-4111-8111-111111111111';
const leaseId = '22222222-2222-4222-8222-222222222222';
const sourceSha256 = 'ab'.repeat(32);

const completion = {
	action: 'complete',
	jobId,
	leaseId,
	sourceSha256,
	backend: 'transformers',
	modelId: 'microsoft/trocr-base-printed',
	modelVersion: '2026.08.1+cpu',
	rawText: 'Texto OCR local',
	correctedText: null,
	contentType: 'handwritten',
	warnings: [{ code: 'low_contrast', message: 'Baixo contraste detectado.' }],
	needsReview: true,
	timingMs: 1432,
	wordGeometry: [] as const
} as const;

describe('desktop worker request contract', () => {
	it('accepts the exact claim, renew, and source shapes', () => {
		expect(parseDesktopWorkerRequest({ action: 'claim' })).toEqual({ action: 'claim' });
		expect(parseDesktopWorkerRequest({ action: 'renew', jobId, leaseId })).toEqual({
			action: 'renew',
			jobId,
			leaseId
		});
		expect(parseDesktopWorkerRequest({ action: 'source', jobId, leaseId })).toEqual({
			action: 'source',
			jobId,
			leaseId
		});
	});

	it('accepts the launch completion payload without mutating OCR text', () => {
		const parsed = parseDesktopWorkerRequest(completion);
		expect(parsed).toEqual(completion);
		if (parsed?.action === 'complete') {
			expect(parsed.rawText).toBe('Texto OCR local');
			expect(parsed.contentType).toBe('handwritten');
			expect(parsed.warnings).toEqual(completion.warnings);
			expect(parsed.wordGeometry).toEqual([]);
		}
	});

	it('rejects completion payloads that omit launch geometry', () => {
		const { wordGeometry: _wordGeometry, ...withoutGeometry } = completion;
		expect(parseDesktopWorkerRequest(withoutGeometry)).toBeNull();
	});

	it('accepts bounded normalized geometry on a completion payload', () => {
		const parsed = parseDesktopWorkerRequest({
			...completion,
			wordGeometry: [['Texto', 1000, 2000, 3000, 2600]]
		});
		expect(parsed?.action).toBe('complete');
		if (parsed?.action === 'complete') {
			expect(parsed.wordGeometry).toEqual([['Texto', 1000, 2000, 3000, 2600]]);
		}
	});

	it('accepts every approved semantic content classification', () => {
		for (const contentType of ['printed', 'handwritten', 'mixed', 'unknown'] as const) {
			expect(parseDesktopWorkerRequest({ ...completion, contentType })?.action).toBe('complete');
		}
	});

	it('rejects widened request objects', () => {
		expect(parseDesktopWorkerRequest({ ...completion, serviceRoleKey: 'never' })).toBeNull();
		expect(parseDesktopWorkerRequest({ action: 'claim', userId: jobId })).toBeNull();
	});

	it('rejects malformed source identity, geometry and unsupported backends', () => {
		expect(
			parseDesktopWorkerRequest({ ...completion, sourceSha256: sourceSha256.toUpperCase() })
		).toBeNull();
		expect(parseDesktopWorkerRequest({ ...completion, backend: 'shell' })).toBeNull();
		expect(parseDesktopWorkerRequest({ ...completion, leaseId: 'not-a-uuid' })).toBeNull();
		expect(
			parseDesktopWorkerRequest({
				...completion,
				wordGeometry: [['Texto', 1000, 2000, 10001, 2600]]
			})
		).toBeNull();
	});

	it('rejects malformed warnings instead of coercing them', () => {
		expect(
			parseDesktopWorkerRequest({
				...completion,
				warnings: [{ code: 'LowContrast', message: 'Baixo contraste detectado.' }]
			})
		).toBeNull();
		expect(
			parseDesktopWorkerRequest({
				...completion,
				warnings: [{ code: 'low_contrast', message: ' padded ' }]
			})
		).toBeNull();
		expect(
			parseDesktopWorkerRequest({
				...completion,
				warnings: [{ code: 'low_contrast', message: 'ok', extra: true }]
			})
		).toBeNull();
	});

	it('enforces text, model, semantic content-type, and timing ceilings', () => {
		expect(parseDesktopWorkerRequest({ ...completion, rawText: 'x'.repeat(1_000_001) })).toBeNull();
		expect(parseDesktopWorkerRequest({ ...completion, modelId: 'bad model' })).toBeNull();
		expect(parseDesktopWorkerRequest({ ...completion, contentType: 'text/plain' })).toBeNull();
		expect(parseDesktopWorkerRequest({ ...completion, contentType: 'diagram' })).toBeNull();
		expect(parseDesktopWorkerRequest({ ...completion, timingMs: 86_400_001 })).toBeNull();
		expect(parseDesktopWorkerRequest({ ...completion, timingMs: 0.5 })).toBeNull();
	});
});
