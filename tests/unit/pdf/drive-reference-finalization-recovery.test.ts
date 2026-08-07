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

function dependencies() {
	const document = { numPages: 1 };
	const destroy = vi.fn().mockResolvedValue(undefined);
	return {
		destroy,
		currentUserId: vi.fn().mockResolvedValue(userId),
		verifyIdentity: vi.fn().mockResolvedValue({
			driveVersion: '4',
			sourceSizeBytes: staged.sourceSizeBytes
		}),
		openDocument: vi.fn().mockResolvedValue({ document, destroy }),
		inspectDocument: vi.fn().mockResolvedValue({
			pageCount: 1,
			nativePages: [],
			pagesNeedingOcr: [1],
			ocrReasonsByPage: [{ pageNumber: 1, reasons: ['no_extractable_text'] }]
		}),
		recordOcrConsent: vi.fn().mockResolvedValue(undefined),
		renderPage: vi.fn().mockResolvedValue(new Blob([new Uint8Array(64)], { type: 'image/webp' })),
		upload: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		finalize: vi.fn().mockRejectedValue(new Error('response lost after commit')),
		recoverPublication: vi.fn().mockResolvedValue(null),
		referencePending: vi.fn().mockResolvedValue(false),
		processPage: vi.fn().mockResolvedValue({ state: 'complete', needsReview: false })
	};
}

describe('Drive PDF finalization recovery', () => {
	it('continues OCR without deleting derivatives when the finalizer committed but its response was lost', async () => {
		const deps = dependencies();
		deps.recoverPublication.mockResolvedValue({
			documentId,
			pageCount: 1,
			ocrPageCount: 1,
			reviewPageCount: 0,
			status: 'processing'
		});

		await expect(
			importStagedDrivePdfReference({
				staged,
				consentGranted: true,
				client: {} as never,
				dependencies: deps
			})
		).resolves.toMatchObject({ documentId, pageCount: 1, ocrCompleted: 1 });

		expect(deps.recoverPublication).toHaveBeenCalledOnce();
		expect(deps.referencePending).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
		expect(deps.processPage).toHaveBeenCalledOnce();
		expect(deps.destroy).toHaveBeenCalledOnce();
	});

	it('cleans derivatives only when a failed publication is confirmed to remain staged', async () => {
		const deps = dependencies();
		deps.referencePending.mockResolvedValue(true);

		await expect(
			importStagedDrivePdfReference({
				staged,
				consentGranted: true,
				client: {} as never,
				dependencies: deps
			})
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');

		expect(deps.recoverPublication).toHaveBeenCalledOnce();
		expect(deps.referencePending).toHaveBeenCalledWith(documentId);
		expect(deps.remove).toHaveBeenCalledWith([`${userId}/${documentId}/pages/1.webp`]);
		expect(deps.processPage).not.toHaveBeenCalled();
	});

	it('preserves derivatives when database state is unknown after finalization failure', async () => {
		const deps = dependencies();
		deps.recoverPublication.mockRejectedValue(new Error('recovery unavailable'));
		deps.referencePending.mockRejectedValue(new Error('staging state unavailable'));

		await expect(
			importStagedDrivePdfReference({
				staged,
				consentGranted: true,
				client: {} as never,
				dependencies: deps
			})
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');

		expect(deps.referencePending).toHaveBeenCalledWith(documentId);
		expect(deps.remove).not.toHaveBeenCalled();
	});
});
