import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopWorkerApiError } from '../../../tools/desktop-worker/client.mjs';
import { flushResultSpool } from '../../../tools/desktop-worker/delivery.mjs';
import { ResultSpool } from '../../../tools/desktop-worker/spool.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_JOB_ID = '22222222-2222-4222-8222-222222222222';
const LEASE_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_SHA = 'a'.repeat(64);
const RESULT_ID = '44444444-4444-4444-8444-444444444444';

const openSpools: ResultSpool[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
	while (openSpools.length) openSpools.pop()?.close();
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});

function result(jobId = JOB_ID) {
	return {
		action: 'complete',
		jobId,
		leaseId: LEASE_ID,
		sourceSha256: SOURCE_SHA,
		backend: 'transformers',
		modelId: 'test-model',
		modelVersion: '1.0.0',
		rawText: 'synthetic transcript',
		correctedText: null,
		warnings: [],
		contentType: 'printed',
		needsReview: false,
		timingMs: 1000
	};
}

function receipt(jobId = JOB_ID, idempotentReplay = false) {
	return {
		jobId,
		pageId: '55555555-5555-4555-8555-555555555555',
		resultId: RESULT_ID,
		status: 'ready',
		idempotentReplay,
		cleanupPending: false
	};
}

async function createSpool() {
	const root = await mkdtemp(join(tmpdir(), 'fichario-worker-delivery-'));
	temporaryDirectories.push(root);
	const spool = new ResultSpool(join(root, 'worker.db'));
	openSpools.push(spool);
	return spool;
}

describe('flushResultSpool', () => {
	it('marks a result accepted only after the server confirms completion', async () => {
		const spool = await createSpool();
		spool.enqueue(result());
		const client = { complete: vi.fn(async () => receipt()) };
		const clock = vi
			.fn()
			.mockReturnValueOnce(new Date('2026-08-10T01:00:00.000Z'))
			.mockReturnValueOnce(new Date('2026-08-10T01:00:01.000Z'));

		const summary = await flushResultSpool({ spool, client }, { now: clock });

		expect(client.complete).toHaveBeenCalledWith(result(), { signal: undefined });
		expect(spool.get(JOB_ID)?.attemptCount).toBe(1);
		expect(spool.get(JOB_ID)?.state).toBe('accepted');
		expect(summary).toEqual({
			delivered: [
				{
					jobId: JOB_ID,
					resultId: RESULT_ID,
					status: 'ready',
					idempotentReplay: false,
					cleanupPending: false
				}
			],
			failures: [],
			remainingPending: 0
		});
	});

	it('accepts the backend idempotent replay receipt after a lost response', async () => {
		const spool = await createSpool();
		spool.enqueue(result());
		const client = { complete: vi.fn(async () => receipt(JOB_ID, true)) };

		const summary = await flushResultSpool({ spool, client });

		expect(summary.delivered[0]?.idempotentReplay).toBe(true);
		expect(spool.get(JOB_ID)?.state).toBe('accepted');
	});

	it('keeps a rejected result pending and reports only the safe API code', async () => {
		const spool = await createSpool();
		spool.enqueue(result());
		const client = {
			complete: vi.fn(async () => {
				throw new DesktopWorkerApiError(409, 'desktop_ocr_completion_rejected');
			})
		};

		const summary = await flushResultSpool({ spool, client });

		expect(spool.get(JOB_ID)?.state).toBe('pending');
		expect(spool.get(JOB_ID)?.attemptCount).toBe(1);
		expect(summary).toEqual({
			delivered: [],
			failures: [
				{
					jobId: JOB_ID,
					code: 'desktop_ocr_completion_rejected',
					httpStatus: 409
				}
			],
			remainingPending: 1
		});
	});

	it('continues flushing independent pending results after one server rejection', async () => {
		const spool = await createSpool();
		spool.enqueue(result(JOB_ID), new Date('2026-08-10T01:00:00.000Z'));
		spool.enqueue(result(SECOND_JOB_ID), new Date('2026-08-10T01:00:01.000Z'));
		const client = {
			complete: vi
				.fn()
				.mockRejectedValueOnce(new DesktopWorkerApiError(409, 'desktop_ocr_completion_rejected'))
				.mockResolvedValueOnce(receipt(SECOND_JOB_ID))
		};

		const summary = await flushResultSpool({ spool, client });

		expect(client.complete).toHaveBeenCalledTimes(2);
		expect(spool.get(JOB_ID)?.state).toBe('pending');
		expect(spool.get(SECOND_JOB_ID)?.state).toBe('accepted');
		expect(summary.remainingPending).toBe(1);
	});

	it('does not start another delivery when the caller signal is already aborted', async () => {
		const spool = await createSpool();
		spool.enqueue(result());
		const client = { complete: vi.fn() };
		const controller = new AbortController();
		controller.abort(new DOMException('stop', 'AbortError'));

		await expect(
			flushResultSpool({ spool, client }, { signal: controller.signal })
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(client.complete).not.toHaveBeenCalled();
		expect(spool.get(JOB_ID)?.attemptCount).toBe(0);
	});
});
