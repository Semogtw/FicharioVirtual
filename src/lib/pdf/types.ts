export type PdfType = 'TextBased' | 'Scanned' | 'ImageBased' | 'Mixed';

export type PdfNativePage = {
	pageNumber: number;
	text: string;
};

export type PdfOcrReason = {
	pageNumber: number;
	reasons: readonly string[];
};

export type PdfLayout = {
	isComplex: boolean;
	pagesWithTables: readonly number[];
	pagesWithColumns: readonly number[];
};

export type PdfInspection = {
	type: PdfType;
	pageCount: number;
	nativePages: readonly PdfNativePage[];
	pagesNeedingOcr: readonly number[];
	ocrReasonsByPage: readonly PdfOcrReason[];
	markdown: string | null;
	title: string | null;
	confidence: number;
	processingTimeMs: number;
	layout: PdfLayout;
	hasEncodingIssues: boolean;
};

export type PdfInspectorProcessResult = {
	pdfType: PdfType;
	markdown?: string;
	pageCount: number;
	processingTimeMs: number;
	pagesNeedingOcr: number[];
	ocrReasonsByPage: Array<{ page: number; reasons: string[] }>;
	title?: string;
	confidence: number;
	layout: {
		isComplex: boolean;
		pagesWithTables: number[];
		pagesWithColumns: number[];
	};
	hasEncodingIssues: boolean;
};

export type PdfWorkerRequest = {
	type: 'inspect';
	id: string;
	file: File;
};

export type PdfWorkerSuccess = {
	type: 'success';
	id: string;
	inspection: PdfInspection;
};

export type PdfWorkerFailure = {
	type: 'failure';
	id: string;
	code: 'invalid_pdf' | 'encrypted_pdf' | 'inspection_failed';
};

export type PdfWorkerResponse = PdfWorkerSuccess | PdfWorkerFailure;

function invalidResult(): never {
	throw new TypeError('Invalid PDF inspection result');
}

function validPage(value: number, pageCount: number) {
	return Number.isInteger(value) && value >= 1 && value <= pageCount;
}

function normalizedPages(values: readonly number[], pageCount: number) {
	if (values.some((value) => !validPage(value, pageCount))) invalidResult();
	return Object.freeze([...new Set(values)].sort((left, right) => left - right));
}

function parseMarkedPages(markdown: string | undefined, pageCount: number) {
	const text = markdown?.trim();
	if (!text) return [];

	const marker = /<!--\s*Page\s+(\d+)\s*-->/gi;
	const matches = [...text.matchAll(marker)];
	if (matches.length === 0) {
		return pageCount === 1 ? [{ pageNumber: 1, text }] : [];
	}

	const seen = new Set<number>();
	return matches.map((match, index) => {
		const pageNumber = Number(match[1]);
		if (!validPage(pageNumber, pageCount) || seen.has(pageNumber)) invalidResult();
		seen.add(pageNumber);
		const start = (match.index ?? 0) + match[0].length;
		const end = matches[index + 1]?.index ?? text.length;
		return {
			pageNumber,
			text: text.slice(start, end).trim()
		};
	});
}

export function routePdfProcessResult(result: PdfInspectorProcessResult): PdfInspection {
	if (
		!['TextBased', 'Scanned', 'ImageBased', 'Mixed'].includes(result.pdfType) ||
		!Number.isInteger(result.pageCount) ||
		result.pageCount < 1 ||
		result.pageCount > 10_000 ||
		!Number.isFinite(result.confidence) ||
		result.confidence < 0 ||
		result.confidence > 1 ||
		!Number.isFinite(result.processingTimeMs) ||
		result.processingTimeMs < 0 ||
		result.layout === null ||
		typeof result.layout !== 'object'
	) {
		invalidResult();
	}

	const pagesNeedingOcr = normalizedPages(result.pagesNeedingOcr, result.pageCount);
	const ocrPageSet = new Set(pagesNeedingOcr);
	const nativePages = Object.freeze(
		parseMarkedPages(result.markdown, result.pageCount)
			.filter((page) => !ocrPageSet.has(page.pageNumber) && page.text.length > 0)
			.map((page) => Object.freeze(page))
	);

	const ocrReasonsByPage = Object.freeze(
		result.ocrReasonsByPage.map((entry) => {
			if (!validPage(entry.page, result.pageCount) || !Array.isArray(entry.reasons)) {
				invalidResult();
			}
			return Object.freeze({
				pageNumber: entry.page,
				reasons: Object.freeze(entry.reasons.filter((reason) => typeof reason === 'string'))
			});
		})
	);

	return Object.freeze({
		type: result.pdfType,
		pageCount: result.pageCount,
		nativePages,
		pagesNeedingOcr,
		ocrReasonsByPage,
		markdown: result.markdown?.trim() || null,
		title: result.title?.trim() || null,
		confidence: result.confidence,
		processingTimeMs: result.processingTimeMs,
		layout: Object.freeze({
			isComplex: result.layout.isComplex === true,
			pagesWithTables: normalizedPages(result.layout.pagesWithTables, result.pageCount),
			pagesWithColumns: normalizedPages(result.layout.pagesWithColumns, result.pageCount)
		}),
		hasEncodingIssues: result.hasEncodingIssues === true
	});
}
