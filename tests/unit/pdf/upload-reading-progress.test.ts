import { describe, expect, it } from 'vitest';
import {
	uploadPdfWithGateway,
	type PdfImportGateway,
	type PdfUploadDependencies
} from '../../../src/lib/pdf/upload';
import type { PdfInspection } from '../../../src/lib/pdf/types';

const userId = '11111111-1111-4111-8111-111111111111';

function inspection(): PdfInspection {
	return {
		type: 'Scanned',
		pageCount: 1,
		nativePages: [],
		pagesNeedingOcr: [1],
		ocrReasonsByPage: [{ pageNumber: 1, reasons: ['no_text_operators'] }],
		markdown: null,
		title: 'Digitalizado',
		confidence: 0.9,
		processingTimeMs: 10,
		layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
		hasEncodingIssues: false
	};
}

const gateway: PdfImportGateway = {
	async currentUserId() {
		return userId;
	},
	async findDuplicate() {
		return null;
	},
	async upload() {},
	async remove() {},
	async createImport(input) {
		return {
			documentId: input.documentId,
			pageCount: 1,
			ocrPageCount: 1,
			reviewPageCount: 0,
			status: 'processing'
		};
	}
};

function pdf() {
	return new File(['pdf'], 'digitalizado.pdf', {
		type: 'application/pdf',
		lastModified: 1_700_000_000_000
	});
}

describe('PDF OCR progress', () => {
	it('announces the reading phase before starting the first OCR request', async () => {
		const progress: Array<{ phase: string; completed: number; total: number }> = [];
		let observedBeforeRequest: (typeof progress)[number] | undefined;
		const dependencies: PdfUploadDependencies = {
			async inspectPdf() {
				return inspection();
			},
			async renderPdfPage() {
				return new Blob(['page'], { type: 'image/webp' });
			},
			async calculateSha256() {
				return 'a'.repeat(64);
			},
			async recordOcrConsent() {},
			async processPageOcr() {
				observedBeforeRequest = progress.at(-1);
				return { state: 'complete', needsReview: false, warningCount: 0 };
			}
		};

		await uploadPdfWithGateway(
			pdf(),
			{
				consentGranted: true,
				onProgress(update) {
					progress.push(update);
				}
			},
			gateway,
			dependencies
		);

		expect(observedBeforeRequest).toEqual({ phase: 'reading', completed: 0, total: 1 });
	});
});
