import { describe, expect, it, vi } from 'vitest';
import {
	uploadPdfWithGateway,
	type PdfImportGateway,
	type PdfUploadDependencies
} from '../../../src/lib/pdf/upload';
import type { PdfInspection } from '../../../src/lib/pdf/types';
import { OcrProcessingError } from '../../../src/lib/services/ocr';

const userId = '11111111-1111-4111-8111-111111111111';

function mixedInspection(): PdfInspection {
	return {
		type: 'Mixed',
		pageCount: 3,
		nativePages: [
			{ pageNumber: 1, text: 'Texto um' },
			{ pageNumber: 3, text: 'Texto três' }
		],
		pagesNeedingOcr: [2],
		ocrReasonsByPage: [{ pageNumber: 2, reasons: ['no_text_operators'] }],
		markdown: null,
		title: 'Apostila',
		confidence: 0.9,
		processingTimeMs: 10,
		layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
		hasEncodingIssues: false
	};
}

function gatewayFixture({ failMetadata = false } = {}) {
	const uploads: Array<{ path: string; type: string }> = [];
	const removed: string[][] = [];
	let descriptorPayload: unknown = null;
	const gateway: PdfImportGateway = {
		async currentUserId() {
			return userId;
		},
		async findDuplicate() {
			return null;
		},
		async upload(path, blob) {
			uploads.push({ path, type: blob.type });
		},
		async remove(paths) {
			removed.push([...paths]);
		},
		async createImport(input) {
			descriptorPayload = input.pages;
			if (failMetadata) throw new Error('metadata failed');
			return {
				documentId: input.documentId,
				pageCount: input.pages.length,
				ocrPageCount: input.pages.filter((page) => page.needsOcr).length,
				reviewPageCount: 0,
				status: 'partially_ready'
			};
		}
	};
	return {
		gateway,
		uploads,
		removed,
		get descriptorPayload() {
			return descriptorPayload;
		}
	};
}

function dependencies() {
	const rendered: number[] = [];
	const processed: string[] = [];
	let consentCalls = 0;
	const values: PdfUploadDependencies = {
		async inspectPdf() {
			return mixedInspection();
		},
		async renderPdfPage(_file, pageNumber) {
			rendered.push(pageNumber);
			return new Blob(['page'], { type: 'image/webp' });
		},
		async calculateSha256() {
			return 'a'.repeat(64);
		},
		async recordOcrConsent() {
			consentCalls += 1;
		},
		async processPageOcr(pageId) {
			processed.push(pageId);
			return { state: 'complete', needsReview: false, warningCount: 0 };
		}
	};
	return {
		values,
		rendered,
		processed,
		get consentCalls() {
			return consentCalls;
		}
	};
}

function pdf() {
	return new File(['pdf'], 'apostila.pdf', {
		type: 'application/pdf',
		lastModified: 1_700_000_000_000
	});
}

describe('uploadPdfWithGateway', () => {
	it('renders and transcribes only pages classified for OCR', async () => {
		const fixture = gatewayFixture();
		const deps = dependencies();

		const result = await uploadPdfWithGateway(pdf(), {}, fixture.gateway, deps.values);

		expect(deps.rendered).toEqual([2]);
		expect(deps.consentCalls).toBe(1);
		expect(deps.processed).toHaveLength(1);
		expect(fixture.uploads.map((item) => item.path)).toEqual([
			expect.stringMatching(new RegExp(`^${userId}/[^/]+/original\\.pdf$`)),
			expect.stringMatching(new RegExp(`^${userId}/[^/]+/pages/2\\.webp$`))
		]);
		expect(fixture.descriptorPayload).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ pageNumber: 1, nativeText: 'Texto um', needsOcr: false }),
				expect.objectContaining({ pageNumber: 2, nativeText: null, needsOcr: true }),
				expect.objectContaining({ pageNumber: 3, nativeText: 'Texto três', needsOcr: false })
			])
		);
		expect(result.ocrCompleted).toBe(1);
	});

	it('counts an already-complete page that needs review correctly', async () => {
		const fixture = gatewayFixture();
		const deps = dependencies();
		deps.values.processPageOcr = async () => ({
			state: 'already_complete',
			needsReview: true
		});

		const result = await uploadPdfWithGateway(pdf(), {}, fixture.gateway, deps.values);

		expect(result.ocrCompleted).toBe(0);
		expect(result.ocrNeedsReview).toBe(1);
		expect(result.ocrPending).toBe(0);
	});

	it('separates permanent OCR failures from retryable pending work', async () => {
		const permanentFixture = gatewayFixture();
		const permanentDeps = dependencies();
		permanentDeps.values.processPageOcr = async () => {
			throw new OcrProcessingError('ocr_not_retryable', false);
		};

		const permanent = await uploadPdfWithGateway(
			pdf(),
			{},
			permanentFixture.gateway,
			permanentDeps.values
		);
		expect(permanent.ocrPending).toBe(0);
		expect(permanent.ocrFailed).toBe(1);

		const retryableFixture = gatewayFixture();
		const retryableDeps = dependencies();
		retryableDeps.values.processPageOcr = async () => {
			throw new OcrProcessingError('ocr_transport_failed', true);
		};

		const retryable = await uploadPdfWithGateway(
			pdf(),
			{},
			retryableFixture.gateway,
			retryableDeps.values
		);
		expect(retryable.ocrPending).toBe(1);
		expect(retryable.ocrFailed).toBe(0);
	});

	it('stops starting new OCR pages after post-publication cancellation', async () => {
		const fixture = gatewayFixture();
		const deps = dependencies();
		deps.values.inspectPdf = async () => ({
			type: 'Scanned',
			pageCount: 3,
			nativePages: [],
			pagesNeedingOcr: [1, 2, 3],
			ocrReasonsByPage: [],
			markdown: null,
			title: 'Digitalizado',
			confidence: 0.9,
			processingTimeMs: 10,
			layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
			hasEncodingIssues: false
		});
		const releases: Array<() => void> = [];
		let calls = 0;
		deps.values.processPageOcr = async () => {
			calls += 1;
			await new Promise<void>((resolve) => releases.push(resolve));
			return { state: 'complete', needsReview: false, warningCount: 0 };
		};
		const controller = new AbortController();

		const pending = uploadPdfWithGateway(
			pdf(),
			{ signal: controller.signal },
			fixture.gateway,
			deps.values
		);
		await vi.waitFor(() => expect(releases).toHaveLength(2));
		controller.abort();
		releases.splice(0).forEach((release) => release());
		await Promise.resolve();
		await Promise.resolve();
		releases.splice(0).forEach((release) => release());

		const result = await pending;
		expect(calls).toBe(2);
		expect(result.ocrCompleted).toBe(2);
		expect(result.ocrPending).toBe(1);
		expect(result.ocrFailed).toBe(0);
	});

	it('does not require OCR consent for a text-only PDF', async () => {
		const fixture = gatewayFixture();
		const deps = dependencies();
		deps.values.inspectPdf = async () => ({
			...mixedInspection(),
			type: 'TextBased',
			pagesNeedingOcr: [],
			ocrReasonsByPage: []
		});

		await uploadPdfWithGateway(pdf(), {}, fixture.gateway, deps.values);

		expect(deps.rendered).toEqual([]);
		expect(deps.consentCalls).toBe(0);
		expect(deps.processed).toEqual([]);
	});

	it('removes every uploaded object when metadata publication fails', async () => {
		const fixture = gatewayFixture({ failMetadata: true });
		const deps = dependencies();

		await expect(uploadPdfWithGateway(pdf(), {}, fixture.gateway, deps.values)).rejects.toThrow(
			'metadata failed'
		);
		expect(fixture.removed).toHaveLength(1);
		expect(fixture.removed[0]).toEqual(fixture.uploads.map((item) => item.path));
	});
});
