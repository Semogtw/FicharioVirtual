import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	ImportResumeStore,
	StoredImageImportRecord
} from '../../../src/lib/import/resume-store';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const resumeKey = '33333333-3333-4333-8333-333333333333';
const pageId = '44444444-4444-4444-8444-444444444444';

const dependencies = vi.hoisted(() => ({
	prepareImage: vi.fn(),
	uploadPreparedImage: vi.fn(),
	processPageOcr: vi.fn(),
	listActiveImportSessions: vi.fn(),
	updateImportSession: vi.fn(async () => undefined),
	createImportSession: vi.fn()
}));

vi.mock('$lib/import/image-client', () => ({
	prepareImage: dependencies.prepareImage
}));

vi.mock('$lib/import/upload', () => ({
	DuplicateImageError: class DuplicateImageError extends Error {
		readonly documentId = '55555555-5555-4555-8555-555555555555';
	},
	uploadPreparedImage: dependencies.uploadPreparedImage
}));

vi.mock('$lib/services/import-sessions', () => ({
	listActiveImportSessions: dependencies.listActiveImportSessions,
	updateImportSession: dependencies.updateImportSession,
	createImportSession: dependencies.createImportSession
}));

vi.mock('$lib/services/ocr-consent', () => ({
	recordOcrConsent: vi.fn(async () => undefined)
}));

vi.mock('$lib/services/ocr', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/services/ocr')>();
	return { ...original, processPageOcr: dependencies.processPageOcr };
});

vi.mock('$lib/stores/session.svelte', () => ({
	sessionState: { user: { id: userId } }
}));

class MemoryStore implements ImportResumeStore {
	readonly records = new Map<string, StoredImageImportRecord>();

	constructor(record: StoredImageImportRecord) {
		this.records.set(record.id, record);
	}

	async put(value: StoredImageImportRecord) {
		this.records.set(value.id, value);
	}

	async list() {
		return [...this.records.values()];
	}

	async delete(id: string) {
		this.records.delete(id);
	}
}

function storedRecord(result: StoredImageImportRecord['result']): StoredImageImportRecord {
	return {
		version: 1,
		id: 'restored-image',
		userId,
		sessionId,
		resumeKey,
		file: new File(['image'], 'page.jpg', { type: 'image/jpeg' }),
		mode: 'standard',
		notebookId: null,
		status: result ? 'waiting' : 'queued',
		preparedBytes: result ? 100 : null,
		result,
		error: result ? 'Leitura pendente.' : null,
		updatedAt: '2026-08-04T18:00:00.000Z'
	};
}

const uploadedPage = {
	documentId: '55555555-5555-4555-8555-555555555555',
	pageId,
	ocrJobId: '66666666-6666-4666-8666-666666666666',
	sha256: 'a'.repeat(64),
	storagePath: `${userId}/document/original.webp`,
	thumbnailPath: `${userId}/document/thumbnail.webp`
};

describe('image import queue restoration', () => {
	beforeEach(() => {
		vi.resetModules();
		dependencies.prepareImage.mockReset();
		dependencies.uploadPreparedImage.mockReset();
		dependencies.processPageOcr.mockReset();
		dependencies.listActiveImportSessions.mockReset();
		dependencies.listActiveImportSessions.mockResolvedValue([
			{ id: sessionId, localResumeKey: resumeKey }
		]);
		dependencies.updateImportSession.mockClear();
		dependencies.createImportSession.mockReset();
		dependencies.createImportSession.mockResolvedValue({ id: sessionId, userId });
	});

	it('resumes OCR without preparing or uploading an already published page', async () => {
		const store = new MemoryStore(storedRecord(uploadedPage));
		dependencies.processPageOcr.mockResolvedValue({
			state: 'already_complete',
			needsReview: false
		});
		const queue = await import('../../../src/lib/stores/import-queue.svelte');

		await queue.restoreImageImports(userId, store);
		await vi.waitFor(() => expect(queue.importQueue.items[0]?.status).toBe('complete'));

		expect(dependencies.processPageOcr).toHaveBeenCalledWith(pageId, undefined, {
			signal: expect.any(AbortSignal)
		});
		expect(dependencies.prepareImage).not.toHaveBeenCalled();
		expect(dependencies.uploadPreparedImage).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(store.records.size).toBe(0));
	});

	it('restarts an unpublished local file through the idempotent upload path', async () => {
		const store = new MemoryStore(storedRecord(null));
		dependencies.prepareImage.mockResolvedValue({
			image: new Blob(['prepared'], { type: 'image/webp' }),
			thumbnail: new Blob(['thumbnail'], { type: 'image/webp' }),
			width: 100,
			height: 100,
			format: 'image/webp',
			originalName: 'page.jpg',
			originalBytes: 5,
			preparedBytes: 8
		});
		dependencies.uploadPreparedImage.mockResolvedValue(uploadedPage);
		dependencies.processPageOcr.mockResolvedValue({
			state: 'complete',
			needsReview: false,
			warningCount: 0
		});
		vi.stubGlobal('URL', {
			createObjectURL: vi.fn(() => 'blob:preview'),
			revokeObjectURL: vi.fn()
		});
		const queue = await import('../../../src/lib/stores/import-queue.svelte');

		await queue.restoreImageImports(userId, store);
		await vi.waitFor(() => expect(queue.importQueue.items[0]?.status).toBe('complete'));

		expect(dependencies.prepareImage).toHaveBeenCalledOnce();
		expect(dependencies.uploadPreparedImage).toHaveBeenCalledOnce();
		expect(dependencies.processPageOcr).toHaveBeenCalledWith(pageId, undefined, {
			signal: expect.any(AbortSignal)
		});
		vi.unstubAllGlobals();
	});
});
