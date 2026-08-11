import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
	prepareImage: vi.fn(async (file: File) => ({
		image: new Blob(['prepared'], { type: 'image/webp' }),
		thumbnail: new Blob(['thumbnail'], { type: 'image/webp' }),
		width: 1200,
		height: 900,
		format: 'image/webp' as const,
		originalName: file.name,
		originalBytes: file.size,
		preparedBytes: 8
	})),
	uploadPreparedImage: vi.fn(async () => ({
		documentId: crypto.randomUUID(),
		pageId: crypto.randomUUID(),
		ocrJobId: crypto.randomUUID(),
		sha256: 'a'.repeat(64),
		storagePath: '11111111-1111-4111-8111-111111111111/document/original.webp',
		thumbnailPath: '11111111-1111-4111-8111-111111111111/document/thumbnail.webp'
	})),
	processPageOcr: vi.fn(async () => ({
		state: 'complete' as const,
		needsReview: false,
		warningCount: 0
	}))
}));

vi.mock('$lib/import/image-client', () => ({
	prepareImage: dependencies.prepareImage
}));

vi.mock('$lib/import/upload', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/import/upload')>();
	return { ...original, uploadPreparedImage: dependencies.uploadPreparedImage };
});

vi.mock('$lib/services/ocr', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/services/ocr')>();
	return { ...original, processPageOcr: dependencies.processPageOcr };
});

vi.mock('$lib/stores/session.svelte', () => ({
	sessionState: { user: { id: '11111111-1111-4111-8111-111111111111' } }
}));

import { addImages, importQueue, removeImport } from '../../../src/lib/stores/import-queue.svelte';

describe('image import queue file identity', () => {
	beforeEach(() => {
		for (const item of [...importQueue.items]) removeImport(item.id);
		dependencies.prepareImage.mockClear();
	});

	it('does not discard distinct images that share file metadata', async () => {
		const first = new File(['aa'], 'page.jpg', {
			type: 'image/jpeg',
			lastModified: 1_700_000_000_000
		});
		const second = new File(['bb'], 'page.jpg', {
			type: 'image/jpeg',
			lastModified: 1_700_000_000_000
		});

		addImages([first, second]);

		expect(importQueue.items).toHaveLength(2);
		await vi.waitFor(() => expect(dependencies.prepareImage).toHaveBeenCalledTimes(2));
	});

	it('still ignores the exact same File object while it remains in the queue', async () => {
		const file = new File(['aa'], 'page.jpg', {
			type: 'image/jpeg',
			lastModified: 1_700_000_000_000
		});

		addImages([file, file]);

		expect(importQueue.items).toHaveLength(1);
		await vi.waitFor(() => expect(dependencies.prepareImage).toHaveBeenCalledTimes(1));
	});
});
