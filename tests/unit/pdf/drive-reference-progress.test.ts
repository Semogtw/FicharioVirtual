import { describe, expect, it, vi } from 'vitest';
import { importStagedDrivePdfReference } from '../../../src/lib/pdf/drive-reference-import';

const staged = {
	documentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
	driveFileId: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
	sourceSizeBytes: 120 * 1024 * 1024,
	status: 'pending_inspection' as const
};

function dependencies() {
	const document = { numPages: 1 };
	const destroy = vi.fn().mockResolvedValue(undefined);
	const lease = {
		attemptId: '11111111-2222-4333-8444-555555555555',
		renew: vi.fn().mockResolvedValue(undefined),
		renewIfNeeded: vi.fn().mockResolvedValue(undefined),
		abandon: vi.fn().mockResolvedValue(true),
		stageAndFinalize: vi
			.fn()
			.mockResolvedValue({
				documentId: staged.documentId,
				pageCount: 1,
				ocrPageCount: 1,
				reviewPageCount: 0,
				status: 'processing'
			})
	};
	return {
		lease,
		currentUserId: vi.fn().mockResolvedValue('11111111-1111-4111-8111-111111111111'),
		verifyIdentity: vi
			.fn()
			.mockResolvedValue({ driveVersion: '4', sourceSizeBytes: staged.sourceSizeBytes }),
		openDocument: vi.fn().mockResolvedValue({ document, destroy }),
		inspectDocument: vi.fn(async (_document, options) => {
			options?.onPage?.(1, 1);
			return {
				pageCount: 1,
				nativePages: [],
				pagesNeedingOcr: [1],
				ocrReasonsByPage: [{ pageNumber: 1, reasons: ['no_extractable_text'] }]
			};
		}),
		acquireDescriptorLease: vi.fn().mockResolvedValue(lease),
		renderPage: vi.fn().mockResolvedValue(new Blob([new Uint8Array(128)], { type: 'image/webp' })),
		upload: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		recoverPublication: vi.fn().mockResolvedValue(null),
		processBatch: vi.fn(async (pageIds: readonly string[]) => ({
			state: 'complete' as const,
			completedPageIds: [...pageIds],
			reviewPageIds: [],
			pendingPageIds: [],
			failedPageIds: [],
			splitRequiredPageIds: [],
			unexpectedResultPageIds: []
		}))
	};
}

describe('oversized Drive PDF progress', () => {
	it('reports durable phases in order and ignores UI observer exceptions', async () => {
		const deps = dependencies();
		const events: string[] = [];
		const onProgress = vi.fn((progress: { phase: string }) => {
			events.push(progress.phase);
			if (progress.phase === 'inspecting') throw new Error('UI observer failed');
		});
		await expect(
			importStagedDrivePdfReference({
				staged,
				client: {} as never,
				dependencies: deps as never,
				onProgress
			})
		).resolves.toMatchObject({ ocrCompleted: 1, ocrPending: 0 });
		expect(events).toEqual([
			'verifying',
			'opening',
			'inspecting',
			'rendering_ocr',
			'publishing',
			'ocr',
			'complete'
		]);
		expect(
			onProgress.mock.calls.find(([value]) => value.phase === 'inspecting')?.[0]
		).toMatchObject({ pageNumber: 1, pageCount: 1 });
		expect(
			onProgress.mock.calls.find(([value]) => value.phase === 'rendering_ocr')?.[0]
		).toMatchObject({ pageNumber: 1, current: 1, total: 1 });
		expect(deps.lease.stageAndFinalize).toHaveBeenCalledOnce();
	});
});
