import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export type DrivePdfRangeInspection = Readonly<{
	pageCount: number;
	nativePages: readonly Readonly<{ pageNumber: number; text: string }>[];
	pagesNeedingOcr: readonly number[];
	ocrReasonsByPage: readonly Readonly<{ pageNumber: number; reasons: readonly string[] }>[];
}>;

function abortError() {
	return new DOMException('Drive PDF inspection was cancelled', 'AbortError');
}

function safelyCleanup(page: PDFPageProxy | null) {
	try {
		page?.cleanup();
	} catch {
		// Page cleanup is best-effort and must not mask the inspection result.
	}
}

function itemText(value: unknown) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const item = value as { str?: unknown; hasEOL?: unknown };
	if (typeof item.str !== 'string') return null;
	return { text: item.str, hasEol: item.hasEOL === true };
}

function normalizeText(items: readonly unknown[]) {
	let output = '';
	for (const value of items) {
		const item = itemText(value);
		if (!item) continue;
		const text = item.text.replace(/\s+/g, ' ').trim();
		if (text.length > 0) {
			if (output.length > 0 && !/[\s\n]$/.test(output)) output += ' ';
			output += text;
		}
		if (item.hasEol && output.length > 0 && !output.endsWith('\n')) output += '\n';
	}
	return output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join('\n')
		.trim();
}

export async function inspectDrivePdfDocument(
	pdfDocument: PDFDocumentProxy,
	options: { signal?: AbortSignal } = {}
): Promise<DrivePdfRangeInspection> {
	if (!Number.isInteger(pdfDocument.numPages) || pdfDocument.numPages < 1) {
		throw new Error('Não foi possível determinar as páginas do PDF remoto.');
	}
	if (pdfDocument.numPages > 10_000) {
		throw new RangeError('O PDF remoto excede o limite lógico de páginas suportado.');
	}
	if (options.signal?.aborted) throw abortError();

	const nativePages: Array<Readonly<{ pageNumber: number; text: string }>> = [];
	const pagesNeedingOcr: number[] = [];
	const ocrReasonsByPage: Array<
		Readonly<{ pageNumber: number; reasons: readonly string[] }>
	> = [];

	for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
		if (options.signal?.aborted) throw abortError();
		let page: PDFPageProxy | null = null;
		try {
			page = await pdfDocument.getPage(pageNumber);
			if (options.signal?.aborted) throw abortError();
			const content = await page.getTextContent();
			if (options.signal?.aborted) throw abortError();
			const text = normalizeText(content.items as readonly unknown[]);
			if (text.length > 0) {
				nativePages.push(Object.freeze({ pageNumber, text }));
			} else {
				pagesNeedingOcr.push(pageNumber);
				ocrReasonsByPage.push(
					Object.freeze({
						pageNumber,
						reasons: Object.freeze(['no_extractable_text'])
					})
				);
			}
		} finally {
			safelyCleanup(page);
		}
	}

	return Object.freeze({
		pageCount: pdfDocument.numPages,
		nativePages: Object.freeze(nativePages),
		pagesNeedingOcr: Object.freeze(pagesNeedingOcr),
		ocrReasonsByPage: Object.freeze(ocrReasonsByPage)
	});
}
