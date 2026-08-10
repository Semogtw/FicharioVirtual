import { describe, expect, it, vi } from 'vitest';
import { runWorkerCycle } from '../../../tools/desktop-worker/runner.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';
const LEASE_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_SHA = 'a'.repeat(64);

function contextFor(error: Error & { code?: string }) {
	const spool = {
		listPending: vi.fn(() => []),
		markAttempt: vi.fn(),
		markAccepted: vi.fn(),
		markRejected: vi.fn(),
		purgeAcceptedBefore: vi.fn(() => 0),
		enqueue: vi.fn()
	};
	const lease = {
		jobId: JOB_ID,
		pageId: PAGE_ID,
		deviceId: '44444444-4444-4444-8444-444444444444',
		leaseId: LEASE_ID,
		leaseExpiresAt: '2026-08-10T03:00:00.000Z'
	};
	const source = {
		jobId: JOB_ID,
		pageId: PAGE_ID,
		documentId: '55555555-5555-4555-8555-555555555555',
		pageNumber: 1,
		leaseId: LEASE_ID,
		leaseExpiresAt: lease.leaseExpiresAt,
		sourceUrl: 'https://example.supabase.co/storage/v1/object/sign/documents/page?token=signed',
		sourceUrlExpiresInSeconds: 60,
		sourceSha256: SOURCE_SHA,
		mimeType: 'image/webp',
		sourceBytes: 16
	};
	const client = {
		claim: vi.fn(async () => lease),
		renew: vi.fn(),
		source: vi.fn(async () => source),
		complete: vi.fn()
	};
	const engine = {
		process: vi.fn(async () => {
			throw error;
		})
	};
	return {
		context: { client, spool, engine, downloadsDir: '/tmp/fichario-worker-test' },
		options: {
			downloadSource: vi.fn(async () => ({
				jobId: JOB_ID,
				path: '/tmp/fichario-worker-source.webp',
				bytes: 16,
				sha256: SOURCE_SHA,
				mimeType: 'image/webp'
			})),
			renewLease: vi.fn(async (_leaseContext, operation) => ({
				value: await operation(),
				lease,
				renewalFailure: null
			})),
			removeFile: vi.fn(async () => undefined)
		}
	};
}

describe('desktop worker engine error codes', () => {
	it('preserves a sanitized local engine code for actionable status reporting', async () => {
		const error = Object.assign(new Error('private model path must not be logged'), {
			code: 'ollama_model_digest_mismatch'
		});
		const { context, options } = contextFor(error);

		const result = await runWorkerCycle(context, options);

		expect(result.status).toBe('processing_deferred');
		expect(result.code).toBe('ollama_model_digest_mismatch');
		expect(JSON.stringify(result)).not.toContain('private model path');
	});

	it('replaces unsafe local error codes with the generic processing failure', async () => {
		const error = Object.assign(new Error('private source path /home/user/page.webp'), {
			code: 'BAD CODE /home/user/page.webp'
		});
		const { context, options } = contextFor(error);

		const result = await runWorkerCycle(context, options);

		expect(result.status).toBe('processing_deferred');
		expect(result.code).toBe('worker_processing_failed');
		expect(JSON.stringify(result)).not.toContain('/home/user/page.webp');
	});
});
