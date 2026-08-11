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

function dependencies() {
	const document = { numPages: 3 };
	const destroy = vi.fn().mockResolvedValue(undefined);
	return {
		document,
		destroy,
		currentUserId: vi.fn().mockResolvedValue(userId),
		verifyIdentity: vi.fn().mockResolvedValue({
			driveVersion: '4',
			sourceSizeBytes: staged.sourceSizeBytes
		}),
		openDocument: vi.fn().mockResolvedValue({ document, destroy }),
		inspectDocument: vi.fn().mockResolvedValue(inspection()),
		recordOcrConsent: vi.fn().mockResolvedValue(undefined),
		renderPage: vi.fn().mockResolvedValue(new Blob([new Uint8Array(1024)], { type: 'image/webp' })),
		upload: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		finalize: vi.fn().mockImplementation(async ({ pages }) => ({
			documentId,
			pageCount: pages.length,
			ocrPageCount: pages.filter((page: { needsOcr: boolean }) => page.needsOcr).length,
			reviewPageCount: 0,
			status: 'partially_ready'
		})),
		recoverPublication: vi.fn().mockResolvedValue(null),
		referencePending: vi.fn().mockResolvedValue(true),
		processPage: vi.fn().mockResolvedValue({ state: 'complete', needsReview: false })
	};
}

describe('importStagedDrivePdfReference', () => {
	it('renders and uploads only OCR pages before atomically finalizing the staged reference', async () => {
		const deps = dependencies();

		const result = await importStagedDrivePdfReference({
			staged,
			consentGranted: true,
			client: {} as never,
			dependencies: deps
		});

		expect(deps.verifyIdentity).toHaveBeenCalledOnce();
		expect(deps.openDocument).toHaveBeenCalledWith(
			expect.objectContaining({
				client: expect.anything(),
				fileId: driveFileId,
				totalBytes: staged.sourceSizeBytes
			})
		);
		expect(deps.inspectDocument).toHaveBeenCalledWith(deps.document, expect.anything());
		expect(deps.recordOcrConsent).toHaveBeenCalledOnce();
		expect(deps.renderPage).toHaveBeenCalledTimes(1);
		expect(deps.renderPage).toHaveBeenCalledWith(
			deps.document,
			2,
			expect.objectContaining({ maxDimension: 2400, quality: 0.88 })
		);
		expect(deps.upload).toHaveBeenCalledTimes(1);
		const [path] = deps.upload.mock.calls[0] ?? [];
		expect(path).toBe(`${userId}/${documentId}/pages/2.webp`);
		expect(deps.finalize).toHaveBeenCalledTimes(1);
		const finalized = deps.finalize.mock.calls[0]?.[0];
		expect(finalized.documentId).toBe(documentId);
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
		expect(deps.processPage).toHaveBeenCalledTimes(1);
		expect(deps.processPage.mock.invocationCallOrder[0]).toBeGreaterThan(
			deps.finalize.mock.invocationCallOrder[0] ?? 0
		);
		expect(deps.remove).not.toHaveBeenCalled();
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

	it('processes required OCR without a per-import confirmation', async () => {
		const deps = dependencies();

		const result = await importStagedDrivePdfReference({
			staged,
			client: {} as never,
			dependencies: deps
		});

		expect(deps.verifyIdentity).toHaveBeenCalledOnce();
		expect(deps.recordOcrConsent).toHaveBeenCalledOnce();
		expect(deps.renderPage).toHaveBeenCalledOnce();
		expect(deps.upload).toHaveBeenCalledOnce();
		expect(deps.finalize).toHaveBeenCalledOnce();
		expect(deps.destroy).toHaveBeenCalledOnce();
		expect(result.ocrCompleted).toBe(1);
	});

	it('removes uploaded derivatives when finalization fails but preserves the Drive reference', async () => {
		const deps = dependencies();
		deps.finalize.mockRejectedValue(new Error('rpc failed'));

		await expect(
			importStagedDrivePdfReference({
				staged,
				consentGranted: true,
				client: {} as never,
				dependencies: deps
			})
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');

		expect(deps.upload).toHaveBeenCalledOnce();
		expect(deps.remove).toHaveBeenCalledWith([`${userId}/${documentId}/pages/2.webp`]);
		expect(deps.processPage).not.toHaveBeenCalled();
		expect(deps.destroy).toHaveBeenCalledOnce();
	});

	it('keeps temporary pages after publication when provider processing is retryable', async () => {
		const deps = dependencies();
		deps.processPage.mockRejectedValue(new Error('provider unavailable'));

		const result = await importStagedDrivePdfReference({
			staged,
			consentGranted: true,
			client: {} as never,
			dependencies: deps
		});

		expect(deps.remove).not.toHaveBeenCalled();
		expect(result).toMatchObject({ ocrCompleted: 0, ocrPending: 1, ocrFailed: 0 });
	});
});
