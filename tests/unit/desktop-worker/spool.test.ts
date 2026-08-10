import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ResultSpool } from '../../../tools/desktop-worker/spool.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const LEASE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_SHA = 'a'.repeat(64);

function result(overrides: Record<string, unknown> = {}) {
	return {
		action: 'complete',
		jobId: JOB_ID,
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
		timingMs: 1000,
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
		expect(first?.result).toEqual(result());
		expect(spool.listPending()).toHaveLength(1);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it('rejects an idempotency collision for the same job', async () => {
		const { spool } = await createSpool();
		spool.enqueue(result());
		expect(() => spool.enqueue(result({ rawText: 'different transcript' }))).toThrow(
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

	it('rejects payloads that diverge from the Edge Function contract', async () => {
		const { spool } = await createSpool();
		expect(() => spool.enqueue(result({ jobId: '../escape' }))).toThrow('completion payload');
		expect(() => spool.enqueue(result({ sourceSha256: 'bad' }))).toThrow('completion payload');
		expect(() => spool.enqueue(result({ backend: 'cpu' }))).toThrow('completion payload');
		expect(() => spool.enqueue(result({ rawText: 'x'.repeat(1_000_001) }))).toThrow(
			'completion payload'
		);
	});
});
