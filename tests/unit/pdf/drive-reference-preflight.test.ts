import { describe, expect, it, vi } from 'vitest';
import { DrivePdfReferenceChangedError } from '../../../src/lib/pdf/drive-reference-identity';
import { importStagedDrivePdfReference } from '../../../src/lib/pdf/drive-reference-import';

const staged = {
	documentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
	driveFileId: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
	sourceSizeBytes: 120 * 1024 * 1024,
	status: 'pending_inspection' as const
};

function dependencies() {
	return {
		currentUserId: vi.fn().mockResolvedValue('11111111-1111-4111-8111-111111111111'),
		verifyIdentity: vi.fn().mockResolvedValue({ driveVersion: '4', sourceSizeBytes: staged.sourceSizeBytes }),
		openDocument: vi.fn(),
		inspectDocument: vi.fn(),
		recordOcrConsent: vi.fn(),
		renderPage: vi.fn(),
		upload: vi.fn(),
		remove: vi.fn(),
		finalize: vi.fn(),
		recoverPublication: vi.fn(),
		referencePending: vi.fn(),
		processPage: vi.fn()
	};
}

describe('oversized Drive PDF identity preflight', () => {
	it('verifies the staged copy before opening PDF.js range transport', async () => {
		const deps = dependencies();
		deps.openDocument.mockRejectedValue(new Error('stop after preflight'));

		await expect(
			importStagedDrivePdfReference({
				staged,
				consentGranted: true,
				client: {} as never,
				dependencies: deps
			})
		).rejects.toThrow('Não foi possível concluir a importação do PDF grande.');

		expect(deps.verifyIdentity).toHaveBeenCalledWith({
			client: expect.anything(),
			documentId: staged.documentId,
			driveFileId: staged.driveFileId,
			sourceSizeBytes: staged.sourceSizeBytes
		});
		expect(deps.verifyIdentity.mock.invocationCallOrder[0]).toBeLessThan(
			deps.openDocument.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
		);
	});

	it('never opens range transport when the controlled Drive copy changed', async () => {
		const deps = dependencies();
		deps.verifyIdentity.mockRejectedValue(new DrivePdfReferenceChangedError());

		await expect(
			importStagedDrivePdfReference({
				staged,
				consentGranted: true,
				client: {} as never,
				dependencies: deps
			})
		).rejects.toBeInstanceOf(DrivePdfReferenceChangedError);

		expect(deps.openDocument).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
	});
});
