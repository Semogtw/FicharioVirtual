import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ResultSpool } from '../../../tools/desktop-worker/spool.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const LEASE_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_SHA = 'a'.repeat(64);
const roots: string[] = [];
const spools: ResultSpool[] = [];

function result() {
	return {
		action: 'complete',
		jobId: JOB_ID,
		leaseId: LEASE_ID,
		sourceSha256: SOURCE_SHA,
		backend: 'ollama',
		modelId: 'qwen3-vl:4b',
		modelVersion: `sha256:${'b'.repeat(64)}`,
		rawText: 'private synthetic transcript',
		correctedText: null,
		warnings: [],
		contentType: 'printed',
		needsReview: false,
		timingMs: 1000,
		wordGeometry: []
	};
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'fichario-worker-retention-'));
	roots.push(root);
	const spool = new ResultSpool(join(root, 'worker.db'));
	spools.push(spool);
	return spool;
}

afterEach(async () => {
	while (spools.length) spools.pop()?.close();
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('desktop worker dead-letter retention', () => {
	it('purges rejected OCR payloads older than the configured spool cutoff', async () => {
		const spool = await fixture();
		spool.enqueue(result(), new Date('2026-08-09T00:00:00.000Z'));
		spool.markAttempt(JOB_ID, new Date('2026-08-09T00:00:01.000Z'));
		spool.markRejected(
			JOB_ID,
			'desktop_ocr_completion_rejected',
			new Date('2026-08-09T00:00:02.000Z')
		);

		expect(spool.getRejected(JOB_ID)?.result.rawText).toBe('private synthetic transcript');
		expect(spool.purgeRejectedBefore(new Date('2026-08-10T00:00:00.000Z'))).toBe(1);
		expect(spool.getRejected(JOB_ID)).toBeNull();
	});

	it('keeps newer rejected payloads until their retention window expires', async () => {
		const spool = await fixture();
		spool.enqueue(result(), new Date('2026-08-10T00:00:00.000Z'));
		spool.markAttempt(JOB_ID, new Date('2026-08-10T00:00:01.000Z'));
		spool.markRejected(
			JOB_ID,
			'desktop_ocr_completion_rejected',
			new Date('2026-08-10T00:00:02.000Z')
		);

		expect(spool.purgeRejectedBefore(new Date('2026-08-09T23:59:59.000Z'))).toBe(0);
		expect(spool.getRejected(JOB_ID)?.reasonCode).toBe('desktop_ocr_completion_rejected');
	});
});
