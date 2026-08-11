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
	const document = { numPages: 4 };
	const destroy = vi.fn().mockResolvedValue(undefined);
	const processBatch = vi.fn().mockImplementation(async (pageIds: readonly string[]) => ({
		state: 'complete' as const,
		completedPageIds: [...pageIds],
		reviewPageIds: pageIds[1] ? [pageIds[1]] : [],
		pendingPageIds: [],
		failedPageIds: [],
		splitRequiredPageIds: [],
		unexpectedResultPageIds: []
	}));
	return {
		destroy,
		processBatch,
		currentUserId: vi.fn().mockResolvedValue(userId),
		verifyIdentity: vi.fn().mockResolvedValue({
			driveVersion: '4',
			sourceSizeBytes: staged.sourceSizeBytes
		}),
		openDocument: vi.fn().mockResolvedValue({ document, destroy }),
		inspectDocument: vi.fn().mockResolvedValue({
			pageCount: 4,
			nativePages: [],
			pagesNeedingOcr: [1, 2, 3, 4],
			ocrReasonsByPage: [1, 2, 3, 4].map((pageNumber) => ({
				pageNumber,
				reasons: ['no_extractable_text']
			}))
		}),
		recordOcrConsent: vi.fn().mockResolvedValue(undefined),
		renderPage: vi
			.fn()
			.mockResolvedValue(new Blob([new Uint8Array(256 * 1024)], { type: 'image/webp' })),
		upload: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		finalize: vi.fn().mockImplementation(async ({ pages }) => ({
			documentId,
			pageCount: pages.length,
			ocrPageCount: pages.length,
			reviewPageCount: 0,
			status: 'processing'
		})),
		recoverPublication: vi.fn().mockResolvedValue(null),
		referencePending: vi.fn().mockResolvedValue(true),
		processPage: vi.fn().mockRejectedValue(new Error('legacy page OCR should not run'))
	};
}

describe('oversized Drive PDF OCR batching', () => {
	it('sends compatible rendered pages through the shared adaptive batch runner', async () => {
		const deps = dependencies();
		const progress: Array<{
			phase: string;
			pageNumber?: number;
			current?: number;
			total?: number;
		}> = [];

		const result = await importStagedDrivePdfReference({
			staged,

			client: {} as never,
			dependencies: deps,
			onProgress: (event) => progress.push(event)
		});

		expect(deps.processBatch).toHaveBeenCalledTimes(1);
		const requestedIds = deps.processBatch.mock.calls[0]?.[0] as readonly string[];
		expect(requestedIds).toHaveLength(4);
		expect(new Set(requestedIds).size).toBe(4);
		expect(deps.processPage).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			documentId,
			pageCount: 4,
			ocrCompleted: 3,
			ocrNeedsReview: 1,
			ocrPending: 0,
			ocrFailed: 0
		});
		expect(progress.filter((event) => event.phase === 'ocr')).toEqual([
			expect.objectContaining({ pageNumber: 1, current: 1, total: 4 }),
			expect.objectContaining({ pageNumber: 2, current: 2, total: 4 }),
			expect.objectContaining({ pageNumber: 3, current: 3, total: 4 }),
			expect.objectContaining({ pageNumber: 4, current: 4, total: 4 })
		]);
		expect(deps.destroy).toHaveBeenCalledOnce();
	});
});
