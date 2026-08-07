import type { PdfImportPagePlan } from './import-plan';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NATIVE_TEXT_CHARS = 120_000;
const MAX_BATCH_SIZE = 100;
const MAX_TEMPORARY_PATH_CHARS = 1024;

export const DEFAULT_DRIVE_PDF_DESCRIPTOR_BATCH_SIZE = 64;

export type DrivePdfReferencePageDescriptor = Readonly<{
	id: string;
	pageNumber: number;
	nativeText: string | null;
	needsOcr: boolean;
	temporaryImagePath: string | null;
	jobId: string | null;
}>;

export type DrivePdfReferencePageBatchStager = (input: {
	documentId: string;
	descriptors: readonly DrivePdfReferencePageDescriptor[];
}) => Promise<void>;

function invalidPlan(): never {
	throw new TypeError('Invalid Drive PDF page descriptor plan');
}

function validString(value: string, maximum: number) {
	if (value.length > maximum) return false;
	for (const character of value) {
		const code = character.codePointAt(0);
		if (code !== undefined && (code < 32 || code === 127)) return false;
	}
	return true;
}

function validateBatchSize(batchSize: number) {
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
		throw new TypeError('Invalid Drive PDF descriptor batch size');
	}
	return batchSize;
}

function validatePages(pages: readonly PdfImportPagePlan[]) {
	if (pages.length < 1) invalidPlan();
	const pageIds = new Set<string>();
	const jobIds = new Set<string>();
	const temporaryPaths = new Set<string>();
	const descriptors: DrivePdfReferencePageDescriptor[] = [];

	for (let index = 0; index < pages.length; index += 1) {
		const page = pages[index];
		if (!page || page.pageNumber !== index + 1 || !UUID.test(page.id) || pageIds.has(page.id)) {
			invalidPlan();
		}
		pageIds.add(page.id);

		if (page.needsOcr) {
			if (
				page.nativeText !== null ||
				typeof page.temporaryImagePath !== 'string' ||
				page.temporaryImagePath.length < 1 ||
				!validString(page.temporaryImagePath, MAX_TEMPORARY_PATH_CHARS) ||
				!page.temporaryImagePath.endsWith(`/pages/${page.pageNumber}.webp`) &&
					!page.temporaryImagePath.endsWith(`/pages/${page.pageNumber}.jpg`) ||
				temporaryPaths.has(page.temporaryImagePath) ||
				typeof page.jobId !== 'string' ||
				!UUID.test(page.jobId) ||
				jobIds.has(page.jobId)
			) {
				invalidPlan();
			}
			temporaryPaths.add(page.temporaryImagePath);
			jobIds.add(page.jobId);
		} else if (
			typeof page.nativeText !== 'string' ||
			!validString(page.nativeText, MAX_NATIVE_TEXT_CHARS) ||
			page.temporaryImagePath !== null ||
			page.jobId !== null
		) {
			invalidPlan();
		}

		descriptors.push(
			Object.freeze({
				id: page.id,
				pageNumber: page.pageNumber,
				nativeText: page.nativeText,
				needsOcr: page.needsOcr,
				temporaryImagePath: page.temporaryImagePath,
				jobId: page.jobId
			})
		);
	}
	return descriptors;
}

function safelyReportBatch(
	onBatch: ((current: number, total: number, stagedPages: number) => void) | undefined,
	current: number,
	total: number,
	stagedPages: number
) {
	try {
		onBatch?.(current, total, stagedPages);
	} catch {
		// UI observers cannot change staging semantics.
	}
}

function abortError() {
	return new DOMException('Drive PDF descriptor staging was cancelled', 'AbortError');
}

export async function stageDrivePdfReferencePageDescriptors({
	documentId,
	pages,
	batchSize: requestedBatchSize = DEFAULT_DRIVE_PDF_DESCRIPTOR_BATCH_SIZE,
	stageBatch,
	onBatch,
	signal
}: {
	documentId: string;
	pages: readonly PdfImportPagePlan[];
	batchSize?: number;
	stageBatch: DrivePdfReferencePageBatchStager;
	onBatch?: (current: number, total: number, stagedPages: number) => void;
	signal?: AbortSignal;
}): Promise<void> {
	if (!UUID.test(documentId)) throw new TypeError('Invalid Drive PDF reference document id');
	const batchSize = validateBatchSize(requestedBatchSize);
	const descriptors = validatePages(pages);
	const totalBatches = Math.ceil(descriptors.length / batchSize);

	for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
		if (signal?.aborted) throw abortError();
		const start = batchIndex * batchSize;
		const batch = Object.freeze(descriptors.slice(start, start + batchSize));
		await stageBatch({ documentId, descriptors: batch });
		if (signal?.aborted) throw abortError();
		safelyReportBatch(
			onBatch,
			batchIndex + 1,
			totalBatches,
			Math.min(descriptors.length, start + batch.length)
		);
	}
}
