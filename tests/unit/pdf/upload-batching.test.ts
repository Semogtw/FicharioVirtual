import { describe, expect, it } from 'vitest';
import {
	uploadPdfWithGateway,
	type PdfImportGateway,
	type PdfUploadDependencies
} from '../../../src/lib/pdf/upload';
import type { PdfInspection } from '../../../src/lib/pdf/types';

const userId = '11111111-1111-4111-8111-111111111111';

function scannedInspection(pageCount: number): PdfInspection {
	return {
		type: 'Scanned',
		pageCount,
		nativePages: [],
		pagesNeedingOcr: Array.from({ length: pageCount }, (_, index) => index + 1),
		ocrReasonsByPage: [],
		markdown: null,
		title: 'Caderno grande',
		confidence: 0.9,
		processingTimeMs: 10,
		layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
		hasEncodingIssues: false
	};
}

function gateway(): PdfImportGateway {
	return {
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
				pageCount: input.pages.length,
				ocrPageCount: input.pages.length,
				reviewPageCount: 0,
				status: 'processing'
			};
		}
	};
}

function complete(pageIds: readonly string[]) {
	return {
		state: 'complete' as const,
		completedPageIds: pageIds,
		reviewPageIds: [],
		pendingPageIds: [],
		failedPageIds: [],
		splitRequiredPageIds: [],
		unexpectedResultPageIds: []
	};
}

describe('large PDF OCR import', () => {
	it('accepts an original larger than the old 20 MiB ceiling and batches rendered pages', async () => {
		const calls: string[][] = [];
		const pageCount = 45;
		const dependencies: PdfUploadDependencies = {
			async inspectPdf() {
				return scannedInspection(pageCount);
			},
			async renderPdfPage() {
				return new Blob(['page'], { type: 'image/webp' });
			},
			async calculateSha256() {
				return 'a'.repeat(64);
			},
			async processOcrBatch(pageIds) {
				calls.push([...pageIds]);
				return complete(pageIds);
			}
		};
		const largePdf = new File([new Uint8Array(21 * 1024 * 1024)], 'grande.pdf', {
			type: 'application/pdf'
		});

		const result = await uploadPdfWithGateway(largePdf, {}, gateway(), dependencies);

		expect(calls.map((call) => call.length)).toEqual([28, 17]);
		expect(result.ocrCompleted).toBe(45);
		expect(result.ocrPending).toBe(0);
	});

	it('rerenders only an oversized temporary page with conservative settings', async () => {
		const renderOptions: Array<{ maxDimension?: number; quality?: number }> = [];
		const dependencies: PdfUploadDependencies = {
			async inspectPdf() {
				return scannedInspection(1);
			},
			async renderPdfPage(_file, _page, options) {
				renderOptions.push(options ?? {});
				return renderOptions.length === 1
					? new Blob([new Uint8Array(13 * 1024 * 1024)], { type: 'image/webp' })
					: new Blob(['smaller'], { type: 'image/webp' });
			},
			async calculateSha256() {
				return 'b'.repeat(64);
			},
			async processOcrBatch(pageIds) {
				return complete(pageIds);
			}
		};

		await uploadPdfWithGateway(
			new File(['pdf'], 'dense.pdf', { type: 'application/pdf' }),
			{},
			gateway(),
			dependencies
		);

		expect(renderOptions).toEqual([
			{ maxDimension: 2400, quality: 0.88, signal: undefined },
			{ maxDimension: 1800, quality: 0.78, signal: undefined }
		]);
	});
});
