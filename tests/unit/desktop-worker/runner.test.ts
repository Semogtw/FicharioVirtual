import { describe, expect, it, vi } from 'vitest';
import { DesktopWorkerApiError } from '../../../tools/desktop-worker/client.mjs';
import { runWorkerCycle } from '../../../tools/desktop-worker/runner.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_ID = '44444444-4444-4444-8444-444444444444';
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';
const RESULT_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_SHA = 'a'.repeat(64);

function lease() {
	return {
		jobId: JOB_ID,
		pageId: PAGE_ID,
		deviceId: DEVICE_ID,
		leaseId: LEASE_ID,
		leaseExpiresAt: '2026-08-10T02:00:00.000Z'
	};
}

function source() {
	return {
		jobId: JOB_ID,
		pageId: PAGE_ID,
		documentId: DOCUMENT_ID,
		pageNumber: 1,
		leaseId: LEASE_ID,
		leaseExpiresAt: '2026-08-10T02:00:00.000Z',
		sourceUrl: 'https://example.supabase.co/storage/v1/object/sign/documents/page?token=signed',
		sourceUrlExpiresInSeconds: 60,
		sourceSha256: SOURCE_SHA,
		mimeType: 'image/webp',
		sourceBytes: 1024
	};
}

function engineOutput() {
	return {
		backend: 'transformers',
		modelId: 'test-model',
		modelVersion: '1.0.0',
		rawText: 'synthetic transcript',
		correctedText: null,
		contentType: 'printed',
		warnings: [],
		needsReview: false,
		timingMs: 1000
	};
}

function receipt() {
	return {
		jobId: JOB_ID,
		pageId: PAGE_ID,
		resultId: RESULT_ID,
		status: 'ready',
		idempotentReplay: false,
		cleanupPending: false
	};
}

class MemorySpool {
	entries = new Map<
		string,
		{
			jobId: string;
			result: Record<string, unknown>;
			state: 'pending' | 'accepted';
			attemptCount: number;
		}
	>();
	rejected = new Map<
		string,
		{ jobId: string; result: Record<string, unknown>; reasonCode: string }
	>();

	enqueue(result: Record<string, unknown>) {
		const jobId = String(result.jobId);
		if (this.rejected.has(jobId)) return this.rejected.get(jobId);
		if (!this.entries.has(jobId)) {
			this.entries.set(jobId, { jobId, result, state: 'pending', attemptCount: 0 });
		}
		return this.entries.get(jobId);
	}

	listPending(limit = 20) {
		return [...this.entries.values()].filter((entry) => entry.state === 'pending').slice(0, limit);
	}

	markAttempt(jobId: string) {
		const entry = this.entries.get(jobId);
		if (!entry || entry.state !== 'pending') return false;
		entry.attemptCount += 1;
		return true;
	}

	markAccepted(jobId: string) {
		const entry = this.entries.get(jobId);
		if (!entry || entry.state !== 'pending') return false;
		entry.state = 'accepted';
		return true;
	}

	markRejected(jobId: string, reasonCode: string) {
		const entry = this.entries.get(jobId);
		if (!entry || entry.state !== 'pending' || entry.attemptCount < 1) return false;
		this.rejected.set(jobId, { jobId, result: entry.result, reasonCode });
		this.entries.delete(jobId);
		return true;
	}

	purgeAcceptedBefore() {
		return 0;
	}
}

function successfulProcessingOptions(removeFile = vi.fn(async () => undefined)) {
	return {
		downloadSource: vi.fn(async () => ({
			jobId: JOB_ID,
			path: '/tmp/private-source.webp',
			bytes: 1024,
			sha256: SOURCE_SHA,
			mimeType: 'image/webp'
		})),
		renewLease: vi.fn(async (_leaseContext, operation) => ({
			value: await operation(),
			lease: lease(),
			renewalFailure: null
		})),
		removeFile
	};
}

describe('runWorkerCycle', () => {
	it('returns idle without touching source or engine when no job is claimable', async () => {
		const spool = new MemorySpool();
		const client = {
			claim: vi.fn(async () => null),
			renew: vi.fn(),
			source: vi.fn(),
			complete: vi.fn()
		};
		const engine = { process: vi.fn() };

		const result = await runWorkerCycle({ client, spool, engine, downloadsDir: '/tmp/test' });

		expect(result.status).toBe('idle');
		expect(client.claim).toHaveBeenCalledOnce();
		expect(client.source).not.toHaveBeenCalled();
		expect(engine.process).not.toHaveBeenCalled();
	});

	it('does not claim new work while a prior computed result has a retryable delivery failure', async () => {
		const spool = new MemorySpool();
		spool.enqueue({ jobId: JOB_ID });
		const client = {
			claim: vi.fn(),
			renew: vi.fn(),
			source: vi.fn(),
			complete: vi.fn(async () => {
				throw new DesktopWorkerApiError(503, 'desktop_ocr_worker_failed');
			})
		};
		const engine = { process: vi.fn() };

		const result = await runWorkerCycle({ client, spool, engine, downloadsDir: '/tmp/test' });

		expect(result.status).toBe('blocked_pending_delivery');
		expect(client.claim).not.toHaveBeenCalled();
		expect(spool.entries.get(JOB_ID)?.attemptCount).toBe(1);
	});

	it('dead-letters a permanently rejected prior result and defers claiming until the next cycle', async () => {
		const spool = new MemorySpool();
		spool.enqueue({ jobId: JOB_ID });
		const client = {
			claim: vi.fn(),
			renew: vi.fn(),
			source: vi.fn(),
			complete: vi.fn(async () => {
				throw new DesktopWorkerApiError(409, 'desktop_ocr_completion_rejected');
			})
		};
		const engine = { process: vi.fn() };

		const result = await runWorkerCycle({ client, spool, engine, downloadsDir: '/tmp/test' });

		expect(result.status).toBe('dead_lettered');
		expect(result.code).toBe('desktop_ocr_completion_rejected');
		expect(client.claim).not.toHaveBeenCalled();
		expect(spool.entries.has(JOB_ID)).toBe(false);
		expect(spool.rejected.get(JOB_ID)?.reasonCode).toBe('desktop_ocr_completion_rejected');
	});

	it('runs claim, verified source, lease-protected engine, durable spool and completion in order', async () => {
		const spool = new MemorySpool();
		const client = {
			claim: vi.fn(async () => lease()),
			renew: vi.fn(),
			source: vi.fn(async () => source()),
			complete: vi.fn(async () => receipt())
		};
		const engine = { process: vi.fn(async () => engineOutput()) };
		const removeFile = vi.fn(async () => undefined);
		const options = successfulProcessingOptions(removeFile);

		const result = await runWorkerCycle(
			{ client, spool, engine, downloadsDir: '/tmp/test' },
			options
		);

		expect(result.status).toBe('completed');
		expect(result.renewalFailure).toBeNull();
		expect(client.source).toHaveBeenCalledWith(JOB_ID, LEASE_ID, { signal: undefined });
		expect(options.downloadSource).toHaveBeenCalledWith(source(), {
			downloadsDir: '/tmp/test',
			signal: undefined
		});
		expect(options.renewLease).toHaveBeenCalledWith(
			{ client, lease: lease() },
			expect.any(Function),
			{
				signal: undefined,
				now: expect.any(Function)
			}
		);
		expect(engine.process).toHaveBeenCalledWith(
			{
				jobId: JOB_ID,
				pageId: PAGE_ID,
				path: '/tmp/private-source.webp',
				mimeType: 'image/webp',
				bytes: 1024,
				sha256: SOURCE_SHA
			},
			{ signal: undefined }
		);
		expect(client.complete).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'complete',
				jobId: JOB_ID,
				leaseId: LEASE_ID,
				sourceSha256: SOURCE_SHA,
				rawText: 'synthetic transcript'
			}),
			{ signal: undefined }
		);
		expect(spool.entries.get(JOB_ID)?.state).toBe('accepted');
		expect(removeFile).toHaveBeenCalledWith('/tmp/private-source.webp');
	});

	it('dead-letters a newly computed result when its immutable completion is permanently rejected', async () => {
		const spool = new MemorySpool();
		const client = {
			claim: vi.fn(async () => lease()),
			renew: vi.fn(),
			source: vi.fn(async () => source()),
			complete: vi.fn(async () => {
				throw new DesktopWorkerApiError(409, 'desktop_ocr_completion_rejected');
			})
		};
		const engine = { process: vi.fn(async () => engineOutput()) };
		const removeFile = vi.fn(async () => undefined);

		const result = await runWorkerCycle(
			{ client, spool, engine, downloadsDir: '/tmp/test' },
			successfulProcessingOptions(removeFile)
		);

		expect(result.status).toBe('dead_lettered');
		expect(result.code).toBe('desktop_ocr_completion_rejected');
		expect(spool.entries.has(JOB_ID)).toBe(false);
		expect(spool.rejected.get(JOB_ID)?.result).toMatchObject({ rawText: 'synthetic transcript' });
		expect(removeFile).toHaveBeenCalledOnce();
	});

	it('keeps a computed result pending when terminal delivery can be retried', async () => {
		const spool = new MemorySpool();
		const client = {
			claim: vi.fn(async () => lease()),
			renew: vi.fn(),
			source: vi.fn(async () => source()),
			complete: vi.fn(async () => {
				throw new DesktopWorkerApiError(0, 'worker_network_failed');
			})
		};
		const engine = { process: vi.fn(async () => engineOutput()) };
		const removeFile = vi.fn(async () => undefined);
		const renewalFailure = { code: 'desktop_ocr_lease_not_active', httpStatus: 409 };
		const options = successfulProcessingOptions(removeFile);
		options.renewLease = vi.fn(async (_leaseContext, operation) => ({
			value: await operation(),
			lease: lease(),
			renewalFailure
		}));

		const result = await runWorkerCycle(
			{ client, spool, engine, downloadsDir: '/tmp/test' },
			options
		);

		expect(result.status).toBe('spooled');
		expect(result.renewalFailure).toEqual(renewalFailure);
		expect(spool.entries.get(JOB_ID)?.state).toBe('pending');
		expect(spool.entries.get(JOB_ID)?.attemptCount).toBe(1);
		expect(removeFile).toHaveBeenCalledOnce();
	});

	it('removes downloaded bytes and does not spool malformed engine output', async () => {
		const spool = new MemorySpool();
		const client = {
			claim: vi.fn(async () => lease()),
			renew: vi.fn(),
			source: vi.fn(async () => source()),
			complete: vi.fn()
		};
		const engine = { process: vi.fn(async () => ({ ...engineOutput(), backend: 'cpu' })) };
		const removeFile = vi.fn(async () => undefined);

		const result = await runWorkerCycle(
			{ client, spool, engine, downloadsDir: '/tmp/test' },
			successfulProcessingOptions(removeFile)
		);

		expect(result.status).toBe('processing_deferred');
		expect(result.code).toBe('worker_processing_failed');
		expect(spool.entries.size).toBe(0);
		expect(client.complete).not.toHaveBeenCalled();
		expect(removeFile).toHaveBeenCalledOnce();
	});
});
