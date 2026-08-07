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

function publication(pageCount: number) {
	return {
		documentId,
		pageCount,
		ocrPageCount: pageCount,
		reviewPageCount: 0,
		status: 'processing'
	};
}

function dependencies(pageCount = 2) {
	const document = { numPages: pageCount };
	const destroy = vi.fn().mockResolvedValue(undefined);
	const lease = {
		attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		renew: vi.fn().mockResolvedValue(undefined),
		renewIfNeeded: vi.fn().mockResolvedValue(undefined),
		stageAndFinalize: vi.fn().mockResolvedValue(publication(pageCount)),
		abandon: vi.fn().mockResolvedValue(true)
	};
	return {
		lease,
		destroy,
		currentUserId: vi.fn().mockResolvedValue(userId),
		verifyIdentity: vi.fn().mockResolvedValue({
			driveVersion: '4',
			sourceSizeBytes: staged.sourceSizeBytes
		}),
		openDocument: vi.fn().mockResolvedValue({ document, destroy }),
		inspectDocument: vi.fn().mockResolvedValue({
			pageCount,
			nativePages: [],
			pagesNeedingOcr: Array.from({ length: pageCount }, (_, index) => index + 1),
			ocrReasonsByPage: Array.from({ length: pageCount }, (_, index) => ({
				pageNumber: index + 1,
				reasons: ['no_extractable_text']
			}))
		}),
		recordOcrConsent: vi.fn().mockResolvedValue(undefined),
		acquireDescriptorLease: vi.fn().mockResolvedValue(lease),
		renderPage: vi
			.fn()
			.mockResolvedValue(new Blob([new Uint8Array(128 * 1024)], { type: 'image/webp' })),
		upload: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		finalize: vi.fn().mockRejectedValue(new Error('legacy finalizer should not run')),
		recoverPublication: vi.fn().mockResolvedValue(null),
		referencePending: vi.fn().mockResolvedValue(true),
		processPage: vi.fn().mockResolvedValue({ state: 'complete', needsReview: false })
	};
}

describe('Drive PDF descriptor lease integration', () => {
	it('acquires before rendering, renews around rendered uploads, and publishes through staged descriptors', async () => {
		const deps = dependencies(2);

		await expect(
			importStagedDrivePdfReference({
				staged,
				consentGranted: true,
				client: {} as never,
				dependencies: deps
			})
		).resolves.toMatchObject({ documentId, pageCount: 2 });

		expect(deps.acquireDescriptorLease).toHaveBeenCalledWith({
			documentId,
			expectedPageCount: 2,
			client: expect.anything()
		});
		expect(deps.acquireDescriptorLease.mock.invocationCallOrder[0]).toBeLessThan(
			deps.renderPage.mock.invocationCallOrder[0]!
		);
		expect(deps.lease.renewIfNeeded).toHaveBeenCalledTimes(4);
		expect(deps.lease.stageAndFinalize).toHaveBeenCalledWith(
			expect.objectContaining({
				pages: expect.arrayContaining([expect.objectContaining({ pageNumber: 1 })]),
				promptVersion: 1
			})
		);
		expect(deps.finalize).not.toHaveBeenCalled();
		expect(deps.lease.abandon).not.toHaveBeenCalled();
	});

	it('does not delete shared derivatives after another attempt has taken over the lease', async () => {
		const deps = dependencies(2);
		deps.lease.renewIfNeeded
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('lease stolen'));
		deps.lease.abandon.mockResolvedValueOnce(false);

		await expect(
			importStagedDrivePdfReference({
				staged,
				consentGranted: true,
				client: {} as never,
				dependencies: deps
			})
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');

		expect(deps.upload).toHaveBeenCalledTimes(1);
		expect(deps.lease.abandon).toHaveBeenCalledOnce();
		expect(deps.remove).not.toHaveBeenCalled();
	});

	it('cleans derivatives when the failed attempt still owns and abandons its lease', async () => {
		const deps = dependencies(2);
		deps.renderPage.mockResolvedValueOnce(
			new Blob([new Uint8Array(128 * 1024)], { type: 'image/webp' })
		);
		deps.renderPage.mockRejectedValueOnce(new Error('renderer failed'));
		deps.lease.abandon.mockResolvedValueOnce(true);

		await expect(
			importStagedDrivePdfReference({
				staged,
				consentGranted: true,
				client: {} as never,
				dependencies: deps
			})
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');

		expect(deps.upload).toHaveBeenCalledTimes(1);
		expect(deps.lease.abandon).toHaveBeenCalledOnce();
		expect(deps.remove).toHaveBeenCalledWith([expect.stringContaining('/pages/1.webp')]);
	});
});
