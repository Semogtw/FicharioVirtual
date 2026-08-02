import type { PdfInspection } from './types';

export type PdfImportPagePlan = {
	id: string;
	pageNumber: number;
	nativeText: string | null;
	needsOcr: boolean;
	temporaryImagePath: string | null;
	jobId: string | null;
};

const STORAGE_ROOT = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

function uuid() {
	const value = globalThis.crypto?.randomUUID?.();
	if (!value) throw new Error('Secure UUID generation is unavailable');
	return value;
}

export function buildPdfImportPlan(
	inspection: PdfInspection,
	storageRoot: string
): readonly PdfImportPagePlan[] {
	if (!STORAGE_ROOT.test(storageRoot) || storageRoot.length > 900) {
		throw new TypeError('Invalid PDF storage root');
	}
	if (!Number.isInteger(inspection.pageCount) || inspection.pageCount < 1 || inspection.pageCount > 10_000) {
		throw new TypeError('Invalid PDF inspection');
	}

	const nativeText = new Map(
		inspection.nativePages.map((page) => [page.pageNumber, page.text] as const)
	);
	const ocrPages = new Set(inspection.pagesNeedingOcr);
	const plan = Array.from({ length: inspection.pageCount }, (_, index) => {
		const pageNumber = index + 1;
		const needsOcr = ocrPages.has(pageNumber);
		return Object.freeze({
			id: uuid(),
			pageNumber,
			nativeText: needsOcr ? null : (nativeText.get(pageNumber) ?? ''),
			needsOcr,
			temporaryImagePath: needsOcr ? `${storageRoot}/pages/${pageNumber}.webp` : null,
			jobId: needsOcr ? uuid() : null
		});
	});

	return Object.freeze(plan);
}
