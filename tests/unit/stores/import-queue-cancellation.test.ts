import { beforeEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

const dependencies = vi.hoisted(() => ({
	processPageOcr: vi.fn()
}));

vi.mock('$lib/import/image-client', () => ({
	prepareImage: vi.fn()
}));

vi.mock('$lib/import/upload', () => ({
	DuplicateImageError: class DuplicateImageError extends Error {
		readonly documentId = '22222222-2222-4222-8222-222222222222';
	},
	uploadPreparedImage: vi.fn()
}));

vi.mock('$lib/services/ocr-consent', () => ({
	recordOcrConsent: vi.fn(async () => undefined)
}));

vi.mock('$lib/services/ocr', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/services/ocr')>();
	return { ...original, processPageOcr: dependencies.processPageOcr };
});

describe('image import queue OCR cancellation', () => {
	beforeEach(() => {
		vi.resetModules();
		dependencies.processPageOcr.mockReset();
	});

	it('aborts a resumed OCR request and does not publish its late completion', async () => {
		const request = deferred<{
			state: 'complete';
			needsReview: boolean;
			warningCount: number;
		}>();
		let signal: AbortSignal | undefined;
		dependencies.processPageOcr.mockImplementation(
			(_pageId: string, _client: unknown, options?: { signal?: AbortSignal }) => {
				signal = options?.signal;
				return request.promise;
			}
		);
		const queue = await import('../../../src/lib/stores/import-queue.svelte');
		const item = {
			id: 'retry-image',
			file: new File(['image'], 'page.jpg', { type: 'image/jpeg' }),
			mode: 'standard' as const,
			notebookId: null,
			status: 'waiting' as const,
			previewUrl: null,
			preparedBytes: 100,
			result: {
				documentId: '22222222-2222-4222-8222-222222222222',
				pageId: '11111111-1111-4111-8111-111111111111',
				ocrJobId: '33333333-3333-4333-8333-333333333333',
				sha256: 'a'.repeat(64),
				storagePath: 'user/document/original.webp',
				thumbnailPath: 'user/document/thumbnail.webp'
			},
			duplicateDocumentId: null,
			error: 'A leitura ficou pendente.'
		};
		queue.importQueue.items.push(item);

		queue.retryImport(item.id);
		await vi.waitFor(() => expect(item.status).toBe('reading'));
		expect(signal?.aborted).toBe(false);

		queue.cancelImport(item.id);
		expect(signal?.aborted).toBe(true);
		request.resolve({ state: 'complete', needsReview: false, warningCount: 0 });

		await vi.waitFor(() => expect(item.status).toBe('cancelled'));
		expect(item.error).toBeNull();
	});
});
