import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
	uploadPdf: vi.fn(async () => ({
		documentId: crypto.randomUUID(),
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
		storagePath: '11111111-1111-4111-8111-111111111111/document/original.pdf',
		ocrCompleted: 0,
		ocrNeedsReview: 0,
		ocrPending: 0,
		ocrFailed: 0
	})),
	saveStoredPdfImport: vi.fn(async () => undefined),
	deleteStoredPdfImport: vi.fn(async () => undefined),
	listStoredPdfImports: vi.fn(async () => []),
	createImportSession: vi.fn(async () => ({
		id: '22222222-2222-4222-8222-222222222222',
		userId: '11111111-1111-4111-8111-111111111111'
	})),
	updateImportSession: vi.fn(async () => undefined),
	listActiveImportSessions: vi.fn(async () => [])
}));

vi.mock('$lib/pdf/upload', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/pdf/upload')>();
	return { ...original, uploadPdf: dependencies.uploadPdf };
});

vi.mock('$lib/pdf/resume-store', () => ({
	saveStoredPdfImport: dependencies.saveStoredPdfImport,
	deleteStoredPdfImport: dependencies.deleteStoredPdfImport,
	listStoredPdfImports: dependencies.listStoredPdfImports
}));

vi.mock('$lib/services/import-sessions', () => ({
	createImportSession: dependencies.createImportSession,
	updateImportSession: dependencies.updateImportSession,
	listActiveImportSessions: dependencies.listActiveImportSessions
}));

vi.mock('$lib/services/ocr-resume', () => ({
	resumeDocumentOcr: vi.fn()
}));

vi.mock('$lib/stores/session.svelte', () => ({
	sessionState: { user: { id: '11111111-1111-4111-8111-111111111111' } }
}));

import {
	addPdfs,
	pdfImportQueue,
	removePdfImport
} from '../../../src/lib/stores/pdf-import-queue.svelte';

describe('PDF import queue file identity', () => {
	beforeEach(() => {
		for (const item of [...pdfImportQueue.items]) removePdfImport(item.id);
		dependencies.uploadPdf.mockClear();
		dependencies.saveStoredPdfImport.mockClear();
		dependencies.deleteStoredPdfImport.mockClear();
		dependencies.createImportSession.mockClear();
		dependencies.updateImportSession.mockClear();
	});

	it('does not discard distinct PDFs that share file metadata', async () => {
		const first = new File(['aa'], 'scan.pdf', {
			type: 'application/pdf',
			lastModified: 1_700_000_000_000
		});
		const second = new File(['bb'], 'scan.pdf', {
			type: 'application/pdf',
			lastModified: 1_700_000_000_000
		});

		addPdfs([first, second], {});

		expect(pdfImportQueue.items).toHaveLength(2);
		await vi.waitFor(() => expect(dependencies.uploadPdf).toHaveBeenCalledTimes(2));
		expect(dependencies.saveStoredPdfImport).toHaveBeenCalled();
	});
});
