import { describe, expect, it, vi } from 'vitest';
import { importStagedDrivePdfReference } from '../../../src/lib/pdf/drive-reference-import';

const staged = {
	documentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
	driveFileId: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
	sourceSizeBytes: 120 * 1024 * 1024,
	status: 'pending_inspection' as const
};

function dependencies() {
	const document = { numPages: 3 };
	const destroy = vi.fn().mockResolvedValue(undefined);
	return {
		document,
		destroy,
		currentUserId: vi.fn().mockResolvedValue('11111111-1111-4111-8111-111111111111'),
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
		recordOcrConsent: vi.fn().mockResolvedValue(undefined),
		renderPage: vi.fn(),
		upload: vi.fn(),
		remove: vi.fn(),
		finalize: vi.fn(),
		recoverPublication: vi.fn(),
		referencePending: vi.fn(),
		processPage: vi.fn()
	};
}

describe('Drive PDF derived page ceiling', () => {
	it('rejects a page when the reduced rerender is still above 12 MiB', async () => {
		const deps = dependencies();
		deps.renderPage
			.mockResolvedValueOnce(new Blob([new Uint8Array(13 * 1024 * 1024)], { type: 'image/webp' }))
			.mockResolvedValueOnce(
				new Blob([new Uint8Array(12 * 1024 * 1024 + 1)], { type: 'image/jpeg' })
			);

		await expect(
			importStagedDrivePdfReference({
				staged,

				client: {} as never,
				dependencies: deps
			})
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');

		expect(deps.renderPage).toHaveBeenCalledTimes(2);
		expect(deps.renderPage.mock.calls[0]?.[2]).toMatchObject({ maxDimension: 2400, quality: 0.88 });
		expect(deps.renderPage.mock.calls[1]?.[2]).toMatchObject({ maxDimension: 1800, quality: 0.78 });
		expect(deps.upload).not.toHaveBeenCalled();
		expect(deps.finalize).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
	});
});
