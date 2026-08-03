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
			{ pageNumber: 3, text: 'Texto trÃªs' }
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

		const result = await uploadPdfWithGateway(
			pdf(),
			{ consentGranted: true },
			fixture.gateway,
			deps.values
		);

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
				expect.objectContaining({ pageNumber: 3, nativeText: 'Texto trÃªs', needsOcr: false })
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

		const result = await uploadPdfWithGateway(
			pdf(),
			{ consentGranted: true },
			fixture.gateway,
			deps.values
		);

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
			{ consentGranted: true },
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
			{ consentGranted: true },
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
			return { state: 'complete', neeYÔ™]šY]Îˆ˜[ÙKØ\›š[™ĞÛİ[ˆNÂ‚B_NÂ‚BXÛÛœİÛÛ›Û\ˆH™]ÈX›ÜÛÛ›Û\Š
NÂ‚‚BXÛÛœİ[™[™ÈH\ØY•Ú]Ø]]Ø^J‚BB\Š
K‚BB^ÈÛÛœÙ[Ü˜[YˆYKÚYÛ˜[ˆÛÛ›Û\‹œÚYÛ˜[K‚BBYš^\™K™Ø]]Ø^K‚BBY\Ë˜[Y\Â‚BJNÂ‚BX]ØZ]šKØZ]›ÜŠ

HOˆ^Xİ
™[X\Ù\ÊKÒ]™S[™İ
ŠJNÂ‚BXÛÛ›Û\‹˜X›Ü

NÂ‚B\™[X\Ù\ËœÜXÙJ
K™›Ü‘XXÚ

™[X\ÙJHOˆ™[X\ÙJ
JNÂ‚BX]ØZ]›ÛZ\ÙKœ™\ÛÛ™J
NÂ‚BX]ØZ]›ÛZ\ÙKœ™\ÛÛ™J
NÂ‚B\™[X\Ù\ËœÜXÙJ
K™›Ü‘XXÚ

™[X\ÙJHOˆ™[X\ÙJ
JNÂ‚‚BXÛÛœİ™\İ[H]ØZ][™[™ÎÂ‚BY^Xİ
Ø[ÊKĞ™JŠNÂ‚BY^Xİ
™\İ[›ØÜÛÛ\]Y
KĞ™JŠNÂ‚BY^Xİ
™\İ[›ØÜ”[™[™ÊKĞ™JJNÂ‚BY^Xİ
™\İ[›ØÜ‘˜Z[Y
KĞ™J
NÂ‚_JNÂ‚‚Z]
	ÙÙ\È›İ™\]Z\™HĞÔˆÛÛœÙ[›ÜˆH^[Û›H‰Ë\Ş[˜È

HOˆÂ‚BXÛÛœİš^\™HHØ]]Ø^Qš^\™J
NÂ‚BXÛÛœİ\ÈH\[™[˜ÚY\Ê
NÂ‚BY\Ë˜[Y\Ëš[œÜXİˆH\Ş[˜È

HOˆ
Â‚BBK‹‹›Z^Y[œÜXİ[ÛŠ
K‚BB]\Nˆ	Õ^˜\ÙY	Ë‚BB\YÙ\Ó™YY[™ÓØÜˆ×K‚BB[ØÜ”™X\ÛÛœĞTYÙNˆ×B‚B_JNÂ‚‚BX]ØZ]\ØY•Ú]Ø]]Ø^JŠ
KÈÛÛœÙ[Ü˜[Yˆ˜[ÙHKš^\™K™Ø]]Ø^K\Ë˜[Y\ÊNÂ‚‚BY^Xİ
\Ëœ™[™\™Y
KÑ\]X[
×JNÂ‚BY^Xİ
\Ë˜ÛÛœÙ[Ø[ÊKĞ™J
NÂ‚BY^Xİ
\Ëœ›ØÙ\ÜÙY
KÑ\]X[
×JNÂ‚_JNÂ‚‚Z]
	Ü™[[İ™\È]™\H\ØYYØš™XİÚ[ˆY]Y]HX›XØ][Ûˆ˜Z[ÉË\Ş[˜È

HOˆÂ‚BXÛÛœİš^\™HHØ]]Ø^Qš^\™JÈ˜Z[Y]Y]NˆYHJNÂ‚BXÛÛœİ\ÈH\[™[˜ÚY\Ê
NÂ‚‚BX]ØZ]^Xİ
‚BB]\ØY•Ú]Ø]]Ø^JŠ
KÈÛÛœÙ[Ü˜[YˆYHKš^\™K™Ø]]Ø^K\Ë˜[Y\ÊB‚BJKœ™Z™XİËÕ›İÊ	ÛY]Y]H˜Z[Y	ÊNÂ‚BY^Xİ
š^\™Kœ™[[İ™Y
KÒ]™S[™İ
JNÂ‚BY^Xİ
š^\™Kœ™[[İ™YÌJKÑ\]X[
š^\™K\ØYË›X\

][JHOˆ][Kœ]
JNÂ‚_JNÂŸJNÂ