import { describe, expect, it, vi } from 'vitest';
import { importStagedDrivePdfReference } from '../../../src/lib/pdf/drive-reference-import';

const userId = '11111111-1111-4111-8111-111111111111';
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const staged = {
	documentId,
	driveFileId: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
	sourceSizeBytes: 120 * 1024 * 1024,
	status: 'pending_inspection' as const
};

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
	const document = { numPages: 1 };
	const destroy = vi.fn().mockResolvedValue(undefined);
	const lease = {
		attemptId: '11111111-2222-4333-8444-555555555555',
		renew: vi.fn().mockResolvedValue(undefined),
		renewIfNeeded: vi.fn().mockResolvedValue(undefined),
		abandon: vi.fn().mockResolvedValue(true),
		stageAndFinalize: vi.fn().mockRejectedValue(new Error('response lost after commit'))
	};
	return {
		lease,
		destroy,
		currentUserId: vi.fn().mockResolvedValue(userId),
		verifyIdentity: vi
			.fn()
			.mockResolvedValue({ driveVersion: '4', sourceSizeBytes: staged.sourceSizeBytes }),
		openDocument: vi.fn().mockResolvedValue({ document, destroy }),
		inspectDocument: vi.fn().mockResolvedValue({
			pageCount: 1,
			nativePages: [],
			pagesNeedingOcr: [1],
			ocrReasonsByPage: [{ pageNumber: 1, reasons: ['no_extractable_text'] }]
		}),
		acquireDescriptorLease: vi.fn().mockResolvedValue(lease),
		renderPage: vi.fn().mockResolvedValue(new Blob([new Uint8Array(64)], { type: 'image/webp' })),
		upload: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		recoverPublication: vi.fn().mockResolvedValue(null),
		processBatch: vi.fn(async (pageIds: readonly string[]) => complete(pageIds))
	};
}

describe('Drive PDF finalization recovery', () => {
	it('continues OCR without deleting derivatives when a committed publication is recovered', async () => {
		const deps = dependencies();
		deps.recoverPublication.mockResolvedValue({
			documentId,
			pageCount: 1,
			ocrPageCount: 1,
			reviewPageCount: 0,
			status: 'processing'
		});

		await expect(
			importStagedDrivePdfReference({ staged, client: {} as never, dependencies: deps as never })
		).resolves.toMatchObject({ documentId, pageCount: 1, ocrCompleted: 1 });

		expect(deps.recoverPublication).toHaveBeenCalledOnce();
		expect(deps.lease.abandon).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
		expect(deps.processBatch).toHaveBeenCalledOnce();
		expect(deps.destroy).toHaveBeenCalledOnce();
	});

	it('abandons the descriptor and cleans derivatives when publication cannot be recovered', async () => {
		const deps = dependencies();

		await expect(
			importStagedDrivePdfReference({ staged, client: {} as never, dependencies: deps as never })
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');

		expect(deps.recoverPublication).toHaveBeenCalledOnce();
		expect(deps.lease.abandon).toHaveBeenCalledOnce();
		expect(deps.remove).toHaveBeenCalledWith([`${userId}/${documentId}/pages/1.webp`]);
		expect(deps.processBatch).not.toHaveBeenCalled();
	});

	it('uses the same safe cleanup path when recovery itself is unavailable', async () => {
		const deps = dependencies();
		deps.recoverPublication.mockRejectedValue(new Error('recovery unavailable'));

		await expect(
			importStagedDrivePdfReference({ staged, client: {} as never, dependencies: deps as never })
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');

		expect(deps.lease.abandon).toHaveBeenCalledOnce();
		expect(deps.remove).toHaveBeenCalledWith([`${userId}/${documentId}/pages/1.webp`]);
	});
});
