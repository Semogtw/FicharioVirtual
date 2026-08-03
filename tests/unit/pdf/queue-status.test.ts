import { describe, expect, it } from 'vitest';
import {
	mergePdfOcrResumeSummary,
	pdfQueueStatusFromResult
} from '../../../src/lib/stores/pdf-import-queue.svelte';
import type { UploadedPdf } from '../../../src/lib/pdf/upload';

function result(overrides: Partial<UploadedPdf> = {}): UploadedPdf {
	return {
		documentId: '11111111-1111-4111-8111-111111111111',
		pageCount: 3,
		ocrPageCount: 1,
		reviewPageCount: 0,
		status: 'partially_ready',
		inspection: {
			type: 'Mixed',
			pageCount: 3,
			nativePages: [],
			pagesNeedingOcr: [2],
			ocrReasonsByPage: [],
			markdown: null,
			title: null,
			confidence: 0.9,
			processingTimeMs: 10,
			layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
			hasEncodingIssues: false
		},
		sha256: 'a'.repeat(64),
		storagePath: 'user/document/original.pdf',
		ocrCompleted: 1,
		ocrNeedsReview: 0,
		ocrPending: 0,
		ocrFailed: 0,
		...overrides
	};
}

describe('pdfQueueStatusFromResult', () => {
	it('keeps a document waiting while any OCR page remains pending', () => {
		expect(pdfQueueStatusFromResult(result({ ocrPending: 1 }))).toBe('waiting');
	});

	it('surfaces terminal OCR failures after pending work is exhausted', () => {
		expect(pdfQueueStatusFromResult(result({ ocrFailed: 1 }))).toBe('failed');
		expect(pdfQueueStatusFromResult(result({ ocrPending: 1, ocrFailed: 1 }))).toBe('waiting');
	});

	it('surfaces native or OCR review requirements', () => {
		expect(pdfQueueStatusFromResult(result({ reviewPageCount: 1 }))).toBe('needs_review');
		expect(pdfQueueStatusFromResult(result({ ocrNeedsReview: 1 }))).toBe('needs_review');
	});

	it('marks the PDF complete only after every page reaches a terminal state', () => {
		expect(pdfQueueStatusFromResult(result())).toBe('complete');
	});
});

describe('mergePdfOcrResumeSummary', () => {
	it('preserves pending pages that were not eligible for this resume pass', () => {
		const merged = mergePdfOcrResumeSummary(result({ ocrCompleted: 0, ocrPending: 3 }), {
			completed: 1,
			needsReview: 0,
			pending: 1,
			failed: 0
		});
		expect(merged).toEqual(expect.objectContaining({
			ocrCompleted: 1,
			ocrNeedsReview: 0,
			ocrPending: 2,
			ocrFailed: 0
		}));
	});

	it('moves terminal failures out of pending without losing other blocked pages', () => {
		const merged = mergePdfOcrResumeSummary(result({ ocrCompleted: 0, ocrPending: 2 }), {
			completed: 0,
			needsReview: 0,
			pending: 0,
			failed: 1
		});
		expect(merged).toEqual(expect.objectContaining({
			ocrCompleted: 0,
			ocrPending: 1,
			ocrFailed: 1
		}));
	});
});
