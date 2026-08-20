import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeImportDocumentId } from '../../../src/lib/native/pending-import';
import {
	uploadPdfWithGateway,
	type PdfImportGateway,
	type PdfUploadDependencies
} from '../../../src/lib/pdf/upload';
import type { PdfInspection } from '../../../src/lib/pdf/types';

const ownerId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';

type MutableGlobal = typeof globalThis & {
	__TAURI__?: { core: { invoke: ReturnType<typeof vi.fn> } };
};

const root = globalThis as MutableGlobal;

afterEach(() => {
	delete root.__TAURI__;
	vi.restoreAllMocks();
});

function pdf(contents = 'same pdf') {
	return new File([contents], 'offline.pdf', {
		type: 'application/pdf',
		lastModified: 1_700_000_000_000
	});
}

function inspection(): PdfInspection {
	return {
		type: 'Digital-born',
		pageCount: 1,
		nativePages: [{ pageNumber: 1, text: 'texto' }],
		pagesNeedingOcr: [],
		ocrReasonsByPage: [],
		markdown: null,
		title: 'Offline',
		confidence: 1,
		processingTimeMs: 1,
		layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
		hasEncodingIssues: false
	};
}

describe('native pending PDF identity', () => {
	it('derives the same native id for the same persisted file across retries', async () => {
		root.__TAURI__ = { core: { invoke: vi.fn() } };
		const first = await nativeImportDocumentId({ ownerId, file: pdf() });
		const retry = await nativeImportDocumentId({ ownerId, file: pdf() });
		expect(first).toBe(retry);
		expect(first).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('keeps the pre-persisted native id through remote publication', async () => {
		let publishedDocumentId: string | null = null;
		const gateway: PdfImportGateway = {
			async currentUserId() {
				return ownerId;
			},
			async findDuplicate() {
				return null;
			},
			async upload() {},
			async remove() {},
			async createImport(input) {
				publishedDocumentId = input.documentId;
				return {
					documentId: input.documentId,
					pageCount: 1,
					ocrPageCount: 0,
					reviewPageCount: 0,
					status: 'ready'
				};
			}
		};
		const dependencies: PdfUploadDependencies = {
			async inspectPdf() {
				return inspection();
			},
			async renderPdfPage() {
				throw new Error('render should not run');
			},
			async calculateSha256() {
				return 'a'.repeat(64);
			},
			async processOcrBatch() {
				throw new Error('OCR should not run');
			}
		};

		const result = await uploadPdfWithGateway(
			pdf(),
			{ nativeDocumentId: documentId },
			gateway,
			dependencies
		);

		expect(publishedDocumentId).toBe(documentId);
		expect(result.documentId).toBe(documentId);
		expect(result.storagePath).toBe(`${ownerId}/${documentId}/original.pdf`);
	});
});
