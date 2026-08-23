import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	claimNativeSyncJobs,
	cancelNativeSyncJob,
	completeNativeSyncJob,
	failNativeSyncJob,
	listNativeSyncJobs
} from '../../../src/lib/native/sync-queue';

type MutableGlobal = typeof globalThis & {
	__TAURI__?: { core: { invoke: ReturnType<typeof vi.fn> } };
};

const root = globalThis as MutableGlobal;

const job = {
	id: 7,
	documentId: 'doc-1',
	operation: 'upload',
	state: 'pending',
	priority: 50,
	attempts: 0,
	nextAttemptAtMs: 0,
	leaseUntilMs: null,
	lastError: null,
	payloadJson: null,
	createdAtMs: 100,
	updatedAtMs: 100
};

afterEach(() => {
	delete root.__TAURI__;
	vi.restoreAllMocks();
});

describe('native sync queue bridge', () => {
	it('stays inert when the web runtime lists or claims jobs', async () => {
		expect(await listNativeSyncJobs()).toBeNull();
		expect(await claimNativeSyncJobs()).toBeNull();
	});

	it('parses queued jobs and forwards list and claim requests', async () => {
		const invoke = vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce([job]);
		root.__TAURI__ = { core: { invoke } };

		expect(await listNativeSyncJobs(12)).toEqual([job]);
		expect(await claimNativeSyncJobs({ limit: 2, leaseMs: 30_000 })).toEqual([job]);
		expect(invoke).toHaveBeenNthCalledWith(1, 'list_native_sync_jobs', {
			request: { limit: 12 }
		});
		expect(invoke).toHaveBeenNthCalledWith(2, 'claim_native_sync_jobs', {
			request: { limit: 2, leaseMs: 30_000 }
		});
	});

	it('rejects malformed native jobs instead of handing them to a worker', async () => {
		const invoke = vi.fn().mockResolvedValue([{ ...job, state: 'unknown' }]);
		root.__TAURI__ = { core: { invoke } };

		await expect(listNativeSyncJobs()).rejects.toThrow('Invalid native sync job');
	});

	it('forwards completion and retry state changes', async () => {
		const invoke = vi.fn().mockResolvedValue(undefined);
		root.__TAURI__ = { core: { invoke } };

		await completeNativeSyncJob(7);
		await failNativeSyncJob({ id: 7, error: 'offline', retryAfterMs: 5_000 });
		await cancelNativeSyncJob({ id: 7, error: 'unsupported' });

		expect(invoke).toHaveBeenNthCalledWith(1, 'complete_native_sync_job', {
			request: { id: 7 }
		});
		expect(invoke).toHaveBeenNthCalledWith(2, 'fail_native_sync_job', {
			request: { id: 7, error: 'offline', retryAfterMs: 5_000 }
		});
		expect(invoke).toHaveBeenNthCalledWith(3, 'cancel_native_sync_job', {
			request: { id: 7, error: 'unsupported' }
		});
	});
});
