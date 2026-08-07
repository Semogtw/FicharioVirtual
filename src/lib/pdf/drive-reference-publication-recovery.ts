import type { PdfImportPagePlan } from './import-plan';
import { parsePdfImportPublication, type PdfImportPublication } from './upload';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINALIZABLE_REFERENCE_STATES = new Set([
	'pending_inspection',
	'inspecting',
	'ready_to_finalize'
]);

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

export type DrivePdfReferenceRecoveryClient = Readonly<{
	from(table: string): {
		select(columns: string): {
			eq(
				column: string,
				value: string
			): {
				maybeSingle(): Promise<QueryResult>;
			};
		};
	};
}>;

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function requireDocumentId(documentId: string) {
	if (!UUID.test(documentId)) throw new TypeError('Invalid Drive PDF reference document id');
}

export function expectedDrivePdfReferencePublication(
	documentId: string,
	pages: readonly PdfImportPagePlan[]
): PdfImportPublication {
	requireDocumentId(documentId);
	if (pages.length < 1 || pages.length > 10_000) {
		throw new TypeError('Invalid Drive PDF reference page plan');
	}

	const ocrPageCount = pages.filter((page) => page.needsOcr).length;
	const reviewPageCount = pages.filter(
		(page) => !page.needsOcr && typeof page.nativeText === 'string' && page.nativeText.trim() === ''
	).length;
	const status =
		ocrPageCount === pages.length
			? 'processing'
			: ocrPageCount > 0
				? 'partially_ready'
				: reviewPageCount > 0
					? 'needs_review'
					: 'ready';

	return parsePdfImportPublication(
		{
			documentId,
			pageCount: pages.length,
			ocrPageCount,
			reviewPageCount,
			status
		},
		documentId
	);
}

export async function recoverDrivePdfReferencePublication({
	client,
	documentId,
	pages
}: {
	client: DrivePdfReferenceRecoveryClient;
	documentId: string;
	pages: readonly PdfImportPagePlan[];
}): Promise<PdfImportPublication | null> {
	const expected = expectedDrivePdfReferencePublication(documentId, pages);
	const { data, error } = await client
		.from('documents')
		.select('id,page_count,status')
		.eq('id', documentId)
		.maybeSingle();
	if (error) throw error;
	if (data === null) return null;
	if (typeof data !== 'object' || Array.isArray(data)) return null;

	const row = data as Record<string, unknown>;
	if (!hasExactKeys(row, ['id', 'page_count', 'status'])) return null;
	if (
		row.id !== expected.documentId ||
		row.page_count !== expected.pageCount ||
		row.status !== expected.status
	) {
		return null;
	}
	return expected;
}

export async function isDrivePdfReferenceStillFinalizable({
	client,
	documentId
}: {
	client: DrivePdfReferenceRecoveryClient;
	documentId: string;
}): Promise<boolean> {
	requireDocumentId(documentId);
	const { data, error } = await client
		.from('drive_pdf_reference_imports')
		.select('document_id,status')
		.eq('document_id', documentId)
		.maybeSingle();
	if (error) throw error;
	if (data === null) return false;
	if (typeof data !== 'object' || Array.isArray(data)) {
		throw new TypeError('Invalid Drive PDF reference staging state');
	}

	const row = data as Record<string, unknown>;
	if (!hasExactKeys(row, ['document_id', 'status']) || row.document_id !== documentId) {
		throw new TypeError('Invalid Drive PDF reference staging state');
	}
	return typeof row.status === 'string' && FINALIZABLE_REFERENCE_STATES.has(row.status);
}
