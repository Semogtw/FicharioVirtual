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
		storagePath: 'user/document/original.webp',
		thumbnailPath: 'user/document/thumbnail.webp'
	})),
	recordOcrConsent: vi.fn(async () => undefined),
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

vi.mock('$lib/services/ocr-consent', () => ({
	recordOcrConsent: dependencies.recordOcrConsent
}));

vi.mock('$lib/services/ocr', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/services/ocr')>();
	return { ...original, processPageOcr: dependencies.processPageOcr };
});

function image(name: string) {
	return new File(['image'], name, { type: 'image/jpeg' });
}

describe('image queue OCR consent lifetime', () => {
	beforeEach(() => {
		vi.resetModules();
		dependencies.recordOcrConsent.mockClear();
	});

	it('coalesces a concurrent batch but records consent again for a later import', async () => {
		const queue = await import('../../../src/lib/stores/import-queue.svelte');
		queue.addImages([image('one.jpg'), image('two.jpg')]);

		await vi.waitFor(() =>
			expect(queue.importQueue.items.every((item) => item.status === 'complete')).toBe(true)
		);
		expect(dependencies.recordOcrConsent).toHaveBeenCalledTimes(1);

		for (const item of [...queue.importQueue.items]) queue.removeImport(item.id);
		queue.addImages([image('three.jpg')]);

		await vi.waitFor(() => expect(queue.importQueue.items[0]?.status).toBe('complete'));
		expect(dependencies.recordOcrConsent).toHaveBeenCalledTimes(2);
	});
});
