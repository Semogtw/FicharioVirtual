import { describe, expect, it } from 'vitest';
import type { NativeDocument } from '../../../src/lib/native/local-document-store';
import type { NativeSyncJob } from '../../../src/lib/native/sync-queue';
import {
	runNativeSyncWorker,
	type NativeSyncWorkerDependencies
} from '../../../src/lib/native/sync-worker';

const document: NativeDocument = {
	documentId: 'doc-worker',
	ownerId: '11111111-1111-4111-8111-111111111111',
	originalFilename: 'worker.pdf',
	mimeType: 'application/pdf',
	sizeBytes: 4,
	sha256: 'a'.repeat(64),
	localState: 'present',
	remoteState: 'pending',
	remoteDocumentId: null,
	driveFileId: null,
	createdAtMs: 1,
	updatedAtMs: 1,
	lastAccessedAtMs: 1
};

function payload() {
	return JSON.stringify({
		version: 1,
		kind: 'upload_original',
		documentId: document.documentId,
		ownerId: document.ownerId,
		originalFilename: document.originalFilename,
		title: 'Worker',
		notebookId: null,
		promptVersion: 1,
		mimeType: document.mimeType,
		sizeBytes: document.sizeBytes,
		sha256: document.sha256,
		relativePath: 'documents/doc-worker/a.pdf',
		remoteDocumentId: null,
		driveFileId: null
	});
}

function job(overrides: Partial<NativeSyncJob> = {}): NativeSyncJob {
	return {
		id: 7,
		documentId: document.documentId,
		operation: 'upload',
		state: 'running',
		priority: 50,
		attempts: 1,
		nextAttemptAtMs: 0,
		leaseUntilMs: 60_000,
		lastError: null,
		payloadJson: payload(),
		createdAtMs: 1,
		updatedAtMs: 1,
		...overrides
	};
}

function dependencies(overrides: Partial<NativeSyncWorkerDependencies> = {}) {
	const calls: string[] = [];
	const value: NativeSyncWorkerDependencies = {
		async claimJobs() {
			calls.push('claim');
			return [job()];
		},
		async resolveDocument() {
			calls.push('resolve');
			return document;
		},
		async readDocument() {
			calls.push('read');
			return new Blob(['data'], { type: document.mimeType });
		},
		async publish() {
			calls.push('publish');
			return { remoteDocumentId: 'remote-worker', driveFileId: 'drive-worker' };
		},
		async markRemoteSynced() {
			calls.push('mark');
		},
		async completeJob() {
			calls.push('complete');
		},
		async failJob() {
			calls.push('fail');
		},
		async cancelJob() {
			calls.push('cancel');
		},
		...overrides
	};
	return { value, calls };
}

describe('native sync worker', () => {
	it('reconstructs a local original, publishes it and completes the job', async () => {
		const fixture = dependencies();

		const result = await runNativeSyncWorker({ dependencies: fixture.value });

		expect(result).toEqual({ claimed: 1, completed: 1, retried: 0, cancelled: 0 });
		expect(fixture.calls).toEqual(['claim', 'resolve', 'read', 'publish', 'mark', 'complete']);
	});

	it('keeps a transient failure retryable across the next claim', async () => {
		const first = dependencies({
			async publish() {
				throw new Error('network offline');
			}
		});
		const firstResult = await runNativeSyncWorker({ dependencies: first.value });

		expect(firstResult).toEqual({ claimed: 1, completed: 0, retried: 1, cancelled: 0 });
		expect(first.calls).toContain('fail');

		const second = dependencies({
			async claimJobs() {
				return [job({ state: 'running', attempts: 2 })];
			}
		});
		const secondResult = await runNativeSyncWorker({ dependencies: second.value });

		expect(secondResult?.completed).toBe(1);
		expect(second.calls).toContain('complete');
	});

	it('cancels malformed payloads instead of retrying them forever', async () => {
		const fixture = dependencies({
			async claimJobs() {
				return [job({ payloadJson: '{"kind":"unknown"}' })];
			}
		});

		const result = await runNativeSyncWorker({ dependencies: fixture.value });

		expect(result).toEqual({ claimed: 1, completed: 0, retried: 0, cancelled: 1 });
		expect(fixture.calls).toEqual(['resolve', 'cancel']);
	});
});
