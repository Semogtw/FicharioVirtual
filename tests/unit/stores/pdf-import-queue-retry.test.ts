import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadedPdf } from '../../../src/lib/pdf/upload';

const resume = vi.hoisted(() => ({
	resumeDocumentOcr: vi.fn()
}));

vi.mock('$lib/pdf/upload', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/pdf/upload')>();
	return { ...original, uploadPdf: vi.fn() };
});

vi.mock('$lib/services/ocr-resume', () => ({
	resumeDocumentOcr: resume.resumeDocumentOcr
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
		storagePath: 'user/document/original.pdf',
		ocrCompleted: 0,
		ocrNeedsReview: 0,
		ocrPending: 3,
		ocrFailed: 0
	};
}

function waitingItem(): PdfQueueItem {
	return {
		id: crypto.randomUUID(),
		file: new File(['pdf'], 'scan.pdf', { type: 'application/pdf' }),
		notebookId: null,
		consentGranted: true,
		status: 'waiting',
		progress: null,
		result: uploadedPdf(),
		duplicateDocumentId: null,
		error: null
	};
}

describe('PDF OCR resume cancellation', () => {
	beforeEach(() => {
		for (const item of [...pdfImportQueue.items]) removePdfImport(item.id);
		resume.resumeDocumentOcr.mockReset();
	});

	it('connects the queue cancel action to the active resume signal', async () => {
		let signal: AbortSignal | undefined;
		let release: (() => void) | undefined;
		resume.resumeDocumentOcr.mockImplementation(
			async (_documentId: string, options?: { signal?: AbortSignal }) => {
				signal = options?.signal;
				await new Promise<void>((resolve) => (release = resolve));
				return { completed: 2, needsReview: 0, pending: 1, failed: 0 };
			}
		);
		const item = waitingItem();
		pdfImportQueue.items.push(item);

		const retry = retryPdfImport(item.id);
		await vi.waitFor(() => expect(signal).toBeDefined());
		cancelPdfImport(item.id);

		expect(signal?.aborted).toBe(true);
		release?.();
		await retry;
		expect(item.status).toBe('waiting');
		expect(item.result).toEqual(
			expect.objectContaining({ ocrCompleted: 2, ocrPending: 1, ocrFailed: 0 })
		);
	});

	it('reports an aborted resume as cancelled instead of a pending failure', async () => {
		resume.resumeDocumentOcr.mockImplementation(
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
