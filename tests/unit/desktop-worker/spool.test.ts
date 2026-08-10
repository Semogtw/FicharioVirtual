import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ResultSpool } from '../../../tools/desktop-worker/spool.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_SHA = 'a'.repeat(64);

function result(overrides: Record<string, unknown> = {}) {
	return {
		jobId: JOB_ID,
		claimNonce: 'opaque-test-nonce',
		sourceSha256: SOURCE_SHA,
		engine: 'desktop',
		backend: 'cpu',
		modelId: 'test-model',
		modelVersion: '1.0.0',
		text: 'synthetic transcript',
		warnings: [],
		contentType: 'printed',
		needsReview: false,
		processingStartedAt: '2026-08-09T00:00:00.000Z',
		processingFinishedAt: '2026-08-09T00:00:01.000Z',
		...overrides
	};
}

const openSpools: ResultSpool[] = [];
afterEach(() => {
	while (openSpools.length) openSpools.pop()?.close();
});

async function createSpool() {
	const root = await mkdtemp(join(tmpdir(), 'fichario-worker-spool-'));
	const path = join(root, 'worker.db');
	const spool = new ResultSpool(path);
	openSpools.push(spool);
	return { path, spool };
}

describe('desktop worker result spool', () => {
	it('stores a pending result idempotently in a private SQLite file', async () => {
		const { path, spool } = await createSpool();
		const first = spool.enqueue(result(), new Date('2026-08-09T00:00:02.000Z'));
		const second = spool.enqueue(result(), new Date('2026-08-09T00:00:03.000Z'));

		expect(first).toEqual(second);
		expect(first?.state).toBe('pending');
		expect(first?.attemptCount).toBe(0);
		expect(spool.listPending()).toHaveLength(1);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it('rejects an idempotency collision for the same job', async () => {
		const { spool } = await createSpool();
		spool.enqueue(result());
		expect(() => spool.enqueue(result({ text: 'different transcript' }))).toThrow(
			'idempotency conflict'
		);
	});

	it('tracks upload attempts and terminal acceptance', async () => {
		const { spool } = await createSpool();
		spool.enqueue(result());
		expect(spool.markAttempt(JOB_ID, new Date('2026-08-09T00:00:02.000Z'))).toBe(true);
		expect(spool.get(JOB_ID)?.attemptCount).toBe(1);
		expect(spool.markAccepted(JOB_ID, new Date('2026-08-09T00:00:03.000Z'))).toBe(true);
		expect(spool.listPending()).toEqual([]);
		expect(spool.get(JOB_ID)?.state).toBe('accepted');
	});

	it('purges only accepted results older than the retention cutoff', async () => {
		const { spool } = await createSpool();
		spool.enqueue(result());
		spool.markAccepted(JOB_ID, new Date('2026-08-09T00:00:03.000Z'));
		expect(spool.purgeAcceptedBefore(new Date('2026-08-09T00:00:04.000Z'))).toBe(1);
		expect(spool.get(JOB_ID)).toBeNull();
	});

	it('rejects invalid job ids, hashes and oversized payloads before persistence', async () => {
		const { spool } = await createSpool();
		expect(() => spool.enqueue(result({ jobId: '../escape' }))).toThrow('jobId');
		expect(() => spool.enqueue(result({ sourceSha256: 'bad' }))).toThrow('sourceSha256');
		expect(() => spool.enqueue(result({ text: 'x'.repeat(2 * 1024 * 1024) }))).toThrow(
			'too large'
		);
	});
});
