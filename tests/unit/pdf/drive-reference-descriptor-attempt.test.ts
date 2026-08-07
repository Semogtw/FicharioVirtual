import { describe, expect, it, vi } from 'vitest';
import { stageAndFinalizeDrivePdfReferenceDescriptors } from '../../../src/lib/pdf/drive-reference-descriptor-attempt';
import type { PdfImportPagePlan } from '../../../src/lib/pdf/import-plan';

const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function pages(count: number): readonly PdfImportPagePlan[] {
	return Array.from({ length: count }, (_, index) => {
		const pageNumber = index + 1;
		const suffix = String(pageNumber).padStart(12, '0');
		return Object.freeze({
			id: `11111111-1111-4111-8111-${suffix}`,
			pageNumber,
			nativeText: `Texto ${pageNumber}`,
			needsOcr: false,
			temporaryImagePath: null,
			jobId: null
		});
	});
}

function dependencies() {
	return {
		createAttemptId: vi.fn(() => attemptId),
		begin: vi.fn().mockResolvedValue(undefined),
		stageBatch: vi.fn().mockResolvedValue(undefined),
		finalize: vi.fn().mockResolvedValue({
			documentId,
			pageCount: 3,
			ocrPageCount: 0,
			reviewPageCount: 0,
			status: 'ready'
		}),
		abandon: vi.fn().mockResolvedValue(undefined)
	};
}

describe('Drive PDF descriptor attempt client', () => {
	it('leases, stages bounded batches, and finalizes one descriptor attempt', async () => {
		const deps = dependencies();
		const source = pages(3);

		await expect(
			stageAndFinalizeDrivePdfReferenceDescriptors({
				documentId,
				pages: source,
				promptVersion: 2,
				batchSize: 2,
				dependencies: deps
			})
		).resolves.toEqual(deps.finalize.mock.results[0]?.value);

		expect(deps.begin).toHaveBeenCalledWith({
			documentId,
			attemptId,
			expectedPageCount: 3
		});
		expect(deps.stageBatch).toHaveBeenCalledTimes(2);
		expect(deps.stageBatch.mock.calls[0]?.[0]).toMatchObject({
			documentId,
			attemptId
		});
		expect(deps.stageBatch.mock.calls[0]?.[0].descriptors).toHaveLength(2);
		expect(deps.stageBatch.mock.calls[1]?.[0].descriptors).toHaveLength(1);
		expect(deps.finalize).toHaveBeenCalledWith({ documentId, attemptId, promptVersion: 2 });
		expect(deps.abandon).not.toHaveBeenCalled();
	});

	it('abandons the matching attempt when a descriptor batch fails', async () => {
		const deps = dependencies();
		deps.stageBatch.mockRejectedValueOnce(new Error('network unavailable'));

		await expect(
			stageAndFinalizeDrivePdfReferenceDescriptors({
				documentId,
				pages: pages(3),
				dependencies: deps
			})
		).rejects.toThrow('network unavailable');
		expect(deps.finalize).not.toHaveBeenCalled();
		expect(deps.abandon).toHaveBeenCalledWith({ documentId, attemptId });
	});

	it('abandons best effort when finalization fails so publication recovery can decide the outcome', async () => {
		const deps = dependencies();
		deps.finalize.mockRejectedValueOnce(new Error('response lost'));
		deps.abandon.mockRejectedValueOnce(new Error('reference already finalized'));

		await expect(
			stageAndFinalizeDrivePdfReferenceDescriptors({
				documentId,
				pages: pages(1),
				dependencies: deps
			})
		).rejects.toThrow('response lost');
		expect(deps.abandon).toHaveBeenCalledWith({ documentId, attemptId });
	});

	it('abandons the attempt when cancellation happens between staged batches', async () => {
		const deps = dependencies();
		const controller = new AbortController();
		deps.stageBatch.mockImplementationOnce(async () => {
			controller.abort();
		});

		await expect(
			stageAndFinalizeDrivePdfReferenceDescriptors({
				documentId,
				pages: pages(3),
				batchSize: 2,
				signal: controller.signal,
				dependencies: deps
			})
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(deps.finalize).not.toHaveBeenCalled();
		expect(deps.abandon).toHaveBeenCalledWith({ documentId, attemptId });
	});

	it('rejects invalid prompt versions before acquiring a lease', async () => {
		const deps = dependencies();
		await expect(
			stageAndFinalizeDrivePdfReferenceDescriptors({
				documentId,
				pages: pages(1),
				promptVersion: 0,
				dependencies: deps
			})
		).rejects.toThrow('Invalid OCR prompt version');
		expect(deps.begin).not.toHaveBeenCalled();
	});
});
