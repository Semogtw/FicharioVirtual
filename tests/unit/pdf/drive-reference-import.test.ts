import { describe, expect, it, vi } from 'vitest';
import { importStagedDrivePdfReference } from '../../../src/lib/pdf/drive-reference-import';
import type { StagedDrivePdfReference } from '../../../src/lib/pdf/drive-reference';

const userId = '11111111-1111-4111-8111-111111111111';
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const driveFileId = '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const staged: StagedDrivePdfReference = {
	documentId,
	driveFileId,
	sourceSizeBytes: 120 * 1024 * 1024,
	status: 'pending_inspection'
};

function inspection() {
	return {
		pageCount: 3,
		nativePages: [
			{ pageNumber: 1, text: 'Texto nativo' },
			{ pageNumber: 3, text: 'Outro texto' }
		],
		pagesNeedingOcr: [2],
		ocrReasonsByPage: [{ pageNumber: 2, reasons: ['no_extractable_text'] }]
	};
}

function complete(pageIds: readonly string[]) {
	return {
		state: 'complete' as const,
		completedPageIds: [...pageIds],
		reviewPageIds: [],
		pendingPageIds: [],
		failedPageIds: [],
		splitRequiredPageIds: [],
		unexpectedResultPageIds: []
	};
}

function dependencies() {
	const document = { numPages: 3 };
	const destroy = vi.fn().mockResolvedValue(undefined);
	const lease = {
		attemptId: '11111111-2222-4333-8444-555555555555',
		renew: vi.fn().mockResolvedValue(undefined),
		renewIfNeeded: vi.fn().mockResolvedValue(undefined),
		abandon: vi.fn().mockResolvedValue(true),
		stageAndFinalize: vi.fn().mockImplementation(async ({ pages }) => ({
			documentId,
			pageCount: pages.length,
			ocrPageCount: pages.filter((page: { needsOcr: boolean }) => page.needsOcr).length,
			reviewPageCount: 0,
			status: 'partially_ready'
		}))
	};
	return {
		document,
		destroy,
		lease,
		currentUserId: vi.fn().mockResolvedValue(userId),
		verifyIdentity: vi
			.fn()
			.mockResolvedValue({ driveVersion: '4', sourceSizeBytes: staged.sourceSizeBytes }),
		openDocument: vi.fn().mockResolvedValue({ document, destroy }),
		inspectDocument: vi.fn().mockResolvedValue(inspection()),
		acquireDescriptorLease: vi.fn().mockResolvedValue(lease),
		renderPage: vi.fn().mockResolvedValue(new Blob([new Uint8Array(1024)], { type: 'image/webp' })),
		upload: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		recoverPublication: vi.fn().mockResolvedValue(null),
		processBatch: vi.fn(async (pageIds: readonly string[]) => complete(pageIds))
	};
}

describe('importStagedDrivePdfReference', () => {
	it('renders only OCR pages, publishes atomically, then runs batch OCR', async () => {
		const deps = dependencies();
		const result = await importStagedDrivePdfReference({
			staged,
			client: {} as never,
			dependencies: deps as never
		});

		expect(deps.verifyIdentity).toHaveBeenCalledOnce();
		expect(deps.openDocument).toHaveBeenCalledWith(
			expect.objectContaining({
				client: expect.anything(),
				fileId: driveFileId,
				totalBytes: staged.sourceSizeBytes
			})
		);
		expect(deps.renderPage).toHaveBeenCalledTimes(1);
		expect(deps.renderPage).toHaveBeenCalledWith(
			deps.document,
			2,
			expect.objectContaining({ maxDimension: 2400, quality: 0.88 })
		);
		expect(deps.upload).toHaveBeenCalledWith(
			`${userId}/${documentId}/pages/2.webp`,
			expect.any(Blob)
		);
		expect(deps.lease.stageAndFinalize).toHaveBeenCalledOnce();
		const finalized = deps.lease.stageAndFinalize.mock.calls[0]?.[0];
		expect(finalized.promptVersion).toBe(1);
		expect(finalized.pages).toHaveLength(3);
		expect(finalized.pages[0]).toMatchObject({
			pageNumber: 1,
			nativeText: 'Texto nativo',
			needsOcr: false,
			temporaryImagePath: null,
			jobId: null
		});
		expect(finalized.pages[1]).toMatchObject({
			pageNumber: 2,
			nativeText: null,
			needsOcr: true,
			temporaryImagePath: `${userId}/${documentId}/pages/2.webp`
		});
		expect(deps.processBatch).toHaveBeenCalledOnce();
		expect(deps.processBatch.mock.invocationCallOrder[0]).toBeGreaterThan(
			deps.lease.stageAndFinalize.mock.invocationCallOrder[0] ?? 0
		);
		expect(deps.remove).not.toHaveBeenCalled();
		expect(deps.lease.abandon).not.toHaveBeenCalled();
		expect(deps.destroy).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			documentId,
			pageCount: 3,
			ocrPageCount: 1,
			ocrCompleted: 1,
			ocrPending: 0,
			ocrFailed: 0
		});
	});

	it('processes required OCR without a per-import consent dependency', async () => {
		const deps = dependencies();
		const result = await importStagedDrivePdfReference({
			staged,
			client: {} as never,
			dependencies: deps as never
		});
		expect('recordOcrConsent' in deps).toBe(false);
		expect(deps.renderPage).toHaveBeenCalledOnce();
		expect(deps.lease.stageAndFinalize).toHaveBeenCalledOnce();
		expect(deps.processBatch).toHaveBeenCalledOnce();
		expect(result.ocrCompleted).toBe(1);
	});

	it('cleans derivatives when descriptor finalization fails and recovery is unavailable', async () => {
		const deps = dependencies();
		deps.lease.stageAndFinalize.mockRejectedValue(new Error('rpc failed'));
		await expect(
			importStagedDrivePdfReference({ staged, client: {} as never, dependencies: deps as never })
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');
		expect(deps.remove).toHaveBeenCalledWith([`${userId}/${documentId}/pages/2.webp`]);
		expect(deps.lease.abandon).toHaveBeenCalledOnce();
		expect(deps.processBatch).not.toHaveBeenCalled();
	});

	it('keeps published derivatives when provider processing remains retryable', async () => {
		const deps = dependencies();
		deps.processBatch.mockRejectedValue(new Error('provider unavailable'));
		const result = await importStagedDrivePdfReference({
			staged,
			client: {} as never,
			dependencies: deps as never
		});
		expect(deps.remove).not.toHaveBeenCalled();
		expect(deps.lease.abandon).not.toHaveBeenCalled();
		expect(result).toMatchObject({ ocrCompleted: 0, ocrPending: 1, ocrFailed: 0 });
	});
});
