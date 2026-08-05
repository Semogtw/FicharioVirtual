import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfResumeStore, StoredPdfImportRecord } from '../../../src/lib/pdf/resume-store';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const resumeKey = '33333333-3333-4333-8333-333333333333';

const dependencies = vi.hoisted(() => ({
	uploadPdf: vi.fn(),
	listImportSessionsByResumeKeys: vi.fn(),
	updateImportSession: vi.fn(async () => undefined),
	createImportSession: vi.fn(),
	publishImportUpdate: vi.fn(),
	subscribeImportUpdates: vi.fn(),
	importUpdateListener: null as
		((update: { type: string; id: string; status: string }) => void) | null
}));

vi.mock('$lib/import/import-broadcast', () => ({
	publishImportUpdate: dependencies.publishImportUpdate,
	subscribeImportUpdates: dependencies.subscribeImportUpdates.mockImplementation((listener) => {
		dependencies.importUpdateListener = listener;
		return vi.fn();
	})
}));

vi.mock('$lib/pdf/upload', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/pdf/upload')>();
	return { ...original, uploadPdf: dependencies.uploadPdf };
});

vi.mock('$lib/services/import-sessions', () => ({
	listImportSessionsByResumeKeys: dependencies.listImportSessionsByResumeKeys,
	updateImportSession: dependencies.updateImportSession,
	createImportSession: dependencies.createImportSession
}));

vi.mock('$lib/services/ocr-resume', () => ({
	resumeDocumentOcr: vi.fn()
}));

vi.mock('$lib/stores/session.svelte', () => ({
	sessionState: { user: { id: '11111111-1111-4111-8111-111111111111' } }
}));

class MemoryStore implements PdfResumeStore {
	readonly records = new Map<string, StoredPdfImportRecord>();
	readonly deleted: Promise<void>;
	private resolveDeleted!: () => void;

	constructor(record: StoredPdfImportRecord) {
		this.records.set(record.id, record);
		this.deleted = new Promise<void>((resolve) => {
			this.resolveDeleted = resolve;
		});
	}

	async put(value: StoredPdfImportRecord) {
		this.records.set(value.id, value);
	}

	async list() {
		return [...this.records.values()];
	}

	async delete(id: string) {
		this.records.delete(id);
		this.resolveDeleted();
	}
}

function storedRecord(): StoredPdfImportRecord {
	return {
		version: 1,
		id: 'restored-pdf',
		userId,
		sessionId,
		resumeKey,
		file: new File(['pdf'], 'notes.pdf', { type: 'application/pdf' }),
		notebookId: null,
		consentGranted: false,
		status: 'uploading',
		inspected: true,
		uploaded: false,
		published: false,
		error: 'A importação foi interrompida.',
		updatedAt: '2026-08-04T18:00:00.000Z'
	};
}

const uploadedPdf = {
	documentId: '44444444-4444-4444-8444-444444444444',
	pageCount: 1,
	ocrPageCount: 0,
	reviewPageCount: 0,
	status: 'ready' as const,
	inspection: {
		type: 'TextBased' as const,
		pageCount: 1,
		nativePages: [{ pageNumber: 1, text: 'Texto' }],
		pagesNeedingOcr: [],
		ocrReasonsByPage: [],
		markdown: 'Texto',
		title: null,
		confidence: 1,
		processingTimeMs: 1,
		layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
		hasEncodingIssues: false
	},
	sha256: 'a'.repeat(64),
	storagePath: `${userId}/document/original.pdf`,
	ocrCompleted: 0,
	ocrNeedsReview: 0,
	ocrPending: 0,
	ocrFailed: 0
};

describe('PDF import queue restoration', () => {
	beforeEach(() => {
		vi.resetModules();
		dependencies.uploadPdf.mockReset();
		dependencies.listImportSessionsByResumeKeys.mockReset();
		dependencies.listImportSessionsByResumeKeys.mockResolvedValue([
			{ id: sessionId, localResumeKey: resumeKey, status: 'paused' }
		]);
		dependencies.updateImportSession.mockClear();
		dependencies.createImportSession.mockReset();
		dependencies.createImportSession.mockResolvedValue({ id: sessionId, userId });
		dependencies.publishImportUpdate.mockClear();
		dependencies.subscribeImportUpdates.mockClear();
		dependencies.importUpdateListener = null;
	});

	it('discards a stored PDF completed remotely before restoration starts', async () => {
		const store = new MemoryStore(storedRecord());
		const queue = await import('../../../src/lib/stores/pdf-import-queue.svelte');
		const listener = dependencies.importUpdateListener;
		if (!listener) throw new Error('Import broadcast listener was not registered.');

		listener({ type: 'pdf-import-updated', id: 'restored-pdf', status: 'complete' });
		await queue.restorePdfImports(userId, store);

		expect(queue.pdfImportQueue.items).toHaveLength(0);
		expect(store.records.size).toBe(0);
		expect(dependencies.uploadPdf).not.toHaveBeenCalled();
		expect(dependencies.updateImportSession).not.toHaveBeenCalled();
	});

	it('discards a stored PDF completed while this tab was closed', async () => {
		const store = new MemoryStore(storedRecord());
		dependencies.listImportSessionsByResumeKeys.mockResolvedValue([
			{ id: sessionId, localResumeKey: resumeKey, status: 'completed' }
		]);
		const queue = await import('../../../src/lib/stores/pdf-import-queue.svelte');

		await queue.restorePdfImports(userId, store);

		expect(dependencies.listImportSessionsByResumeKeys).toHaveBeenCalledWith(userId, [resumeKey]);
		expect(queue.pdfImportQueue.items).toHaveLength(0);
		expect(store.records.size).toBe(0);
		expect(dependencies.uploadPdf).not.toHaveBeenCalled();
		expect(dependencies.updateImportSession).not.toHaveBeenCalled();
	});

	it('restarts an unpublished PDF and removes the local file after publication', async () => {
		const store = new MemoryStore(storedRecord());
		dependencies.uploadPdf.mockImplementation(async (_file, options) => {
			options.onProgress?.({ phase: 'inspecting', completed: 1, total: 1 });
			options.onProgress?.({ phase: 'uploading', completed: 1, total: 1 });
			options.onProgress?.({ phase: 'publishing', completed: 1, total: 1 });
			return uploadedPdf;
		});
		const queue = await import('../../../src/lib/stores/pdf-import-queue.svelte');

		await queue.restorePdfImports(userId, store);
		await vi.waitFor(() => expect(queue.pdfImportQueue.items[0]?.status).toBe('complete'));

		expect(dependencies.uploadPdf).toHaveBeenCalledWith(
			expect.any(File),
			expect.objectContaining({
				notebookId: null,
				consentGranted: false,
				signal: expect.any(AbortSignal),
				onProgress: expect.any(Function)
			})
		);
		await store.deleted;
		expect(store.records.size).toBe(0);
		expect(dependencies.updateImportSession).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				status: 'completed',
				preparedItems: 1,
				uploadedItems: 1,
				completedItems: 1
			})
		);
	});
});
