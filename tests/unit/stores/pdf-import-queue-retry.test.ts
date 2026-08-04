import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadedPdf } from '../../../src/lib/pdf/upload';
import type { OcrResumeSummary } from '../../../src/lib/services/ocr-resume';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

const dependencies = vi.hoisted(() => ({
	resumeDocumentOcr: vi.fn(),
	saveStoredPdfImport: vi.fn(async () => undefined),
	deleteStoredPdfImport: vi.fn(async () => undefined),
	createImportSession: vi.fn(async () => ({
		id: '22222222-2222-4222-8222-222222222222',
		userId: '11111111-1111-4111-8111-111111111111'
	})),
	updateImportSession: vi.fn(async () => undefined)
}));

vi.mock('$lib/pdf/upload', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/pdf/upload')>();
	return { ...original, uploadPdf: vi.fn() };
});

vi.mock('$lib/pdf/resume-store', () => ({
	saveStoredPdfImport: dependencies.saveStoredPdfImport,
	deleteStoredPdfImport: dependencies.deleteStoredPdfImport,
	listStoredPdfImports: vi.fn(async () => [])
}));

vi.mock('$lib/services/import-sessions', () => ({
	createImportSession: dependencies.createImportSession,
	updateImportSession: dependencies.updateImportSession,
	listActiveImportSessions: vi.fn(async () => [])
}));

vi.mock('$lib/services/ocr-resume', () => ({
	resumeDocumentOcr: dependencies.resumeDocumentOcr
}));

import {
	cancelPdfImport,
	pdfImportQueue,
	removePdfImport,
	retryPdfImport,
	type PdfQueueItem
} from '../../../src/lib/stores/pdf-import-queue.svelte';

function uploadedPdf(): UploadedPdf {
	return {
		documentId: '11111111-1111-4111-8111-111111111111',
		pageCount: 3,
		ocrPageCount: 3,
		reviewPageCount: 0,
		status: 'processing',
		inspection: {
			type: 'Scanned',
			pageCount: 3,
			nativePages: [],
			pagesNeedingOcr: [1, 2, 3],
			ocrReasonsByPage: [],
			markdown: null,
			title: null,
			confidence: 0.9,
			processingTimeMs: 1,
			layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
			hasEncodingIssues: false
		},
		sha256: 'a'.repeat(64),
		storagePath: '11111111-1111-4111-8111-111111111111/document/original.pdf',
		ocrCompleted: 0,
		ocrNeedsReview: 0,
		ocrPending: 3,
		ocrFailed: 0
	};
}

function waitingItem(): PdfQueueItem {
	return {
		id: crypto.randomUUID(),
		userId: '11111111-1111-4111-8111-111111111111',
		sessionId: null,
		resumeKey: crypto.randomUUID(),
		file: new File(['pdf'], 'scan.pdf', { type: 'application/pdf' }),
		notebookId: null,
		consentGranted: true,
		status: 'waiting',
		progress: null,
		inspected: true,
		uploaded: true,
		published: true,
		result: uploadedPdf(),
		duplicateDocumentId: null,
		error: null
	};
}

describe('PDF OCR resume cancellation', () => {
	beforeEach(() => {
		for (const item of [...pdfImportQueue.items]) removePdfImport(item.id);
		dependencies.resumeDocumentOcr.mockReset();
		dependencies.saveStoredPdfImport.mockClear();
		dependencies.deleteStoredPdfImport.mockClear();
		dependencies.createImportSession.mockClear();
		dependencies.updateImportSession.mockClear();
	});

	it('preserves a valid completion returned after the active signal was cancelled', async () => {
		const request = deferred<OcrResumeSummary>();
		let signal: AbortSignal | undefined;
		dependencies.resumeDocumentOcr.mockImplementation(
			(_documentId: string, options?: { signal?: AbortSignal }) => {
				signal = options?.signal;
				return request.promise;
			}
		);
		const item = waitingItem();
		pdfImportQueue.items.push(item);

		const retry = retryPdfImport(item.id);
		await vi.waitFor(() => expect(signal).toBeDefined());
		cancelPdfImport(item.id);

		expect(signal?.aborted).toBe(true);
		request.resolve({ completed: 2, needsReview: 0, pending: 1, failed: 0 });
		await retry;

		expect(item.status).toBe('waiting');
		expect(item.result).toEqual(
			expect.objectContaining({ ocrCompleted: 2, ocrPending: 1, ocrFailed: 0 })
		);
	});

	it('reports an aborted resume as cancelled instead of a pending failure', async () => {
		dependencies.resumeDocumentOcr.mockImplementation(
			(_documentId: string, options?: { signal?: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					options?.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('OCR resume was cancelled', 'AbortError')),
						{ once: true }
					);
				})
		);
		const item = waitingItem();
		pdfImportQueue.items.push(item);

		const retry = retryPdfImport(item.id);
		await vi.waitFor(() => expect(item.status).toBe('reading'));
		cancelPdfImport(item.id);
		await retry;

		expect(item.status).toBe('cancelled');
		expect(item.error).toBeNull();
		expect(item.result).toEqual(uploadedPdf());
	});
});
