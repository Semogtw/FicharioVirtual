import { invokeNative, isNativeRuntime } from '$lib/platform/native-bridge';
import type { DocumentStatus } from '$lib/domain/document';
import type { PageWarning } from '$lib/domain/page';
import type { WordGeometry } from '$lib/ocr/word-geometry';
import type { ExtractionSource, ProcessingStatus } from '$lib/types/database';

const DEFAULT_CHUNK_BYTES = 256 * 1024;
const MAX_SAFE_CHUNK_BYTES = 512 * 1024;

export type NativeDocument = Readonly<{
	documentId: string;
	ownerId: string;
	originalFilename: string;
	mimeType: string;
	sizeBytes: number;
	sha256: string;
	localState: 'present' | 'missing' | 'corrupt';
	remoteState: 'pending' | 'synced' | 'remote-only';
	remoteDocumentId: string | null;
	driveFileId: string | null;
	createdAtMs: number;
	updatedAtMs: number;
	lastAccessedAtMs: number;
	title?: string | null;
	notebookId?: string | null;
	pageCount?: number;
	status?: DocumentStatus | null;
}>;

export type NativeDocumentPageMetadata = Readonly<{
	documentId: string;
	pageNumber: number;
	nativeText: string | null;
	ocrRawText?: string | null;
	correctedText?: string | null;
	extractionSource?: ExtractionSource | null;
	wordGeometry?: readonly WordGeometry[];
	warnings?: readonly PageWarning[];
	wasManuallyReviewed?: boolean;
	status:
		'pending' | 'processing' | 'ready' | 'retryable' | 'blocked_quota' | 'needs_review' | 'failed';
	updatedAtMs: number;
}>;

export type NativeDocumentMetadataInput = Readonly<{
	documentId: string;
	ownerId: string;
	title: string;
	notebookId?: string | null;
	pageCount: number;
	status: Exclude<DocumentStatus, 'uploading' | 'pending'>;
	pages: readonly Readonly<{
		pageNumber: number;
		nativeText: string | null;
		ocrRawText?: string | null;
		correctedText?: string | null;
		extractionSource?: ExtractionSource | null;
		wordGeometry?: readonly WordGeometry[];
		warnings?: readonly PageWarning[];
		wasManuallyReviewed?: boolean;
	}>[];
}>;

export type NativeSearchPage = Readonly<{
	documentId: string;
	documentTitle: string;
	notebookId: string | null;
	pageNumber: number;
	nativeText: string;
	rank: number;
}>;

export type NativeDocumentPageCursor = Readonly<{
	lastAccessedAtMs: number;
	documentId: string;
}>;

export type NativeDocumentPage = Readonly<{
	documents: readonly NativeDocument[];
	nextCursor: NativeDocumentPageCursor | null;
}>;

export type NativeStatus = Readonly<{
	platform: string;
	schemaVersion: number;
	localDocumentCount: number;
	pendingSyncCount: number;
	diskUsageBytes: number;
	maxDocumentBytes: number;
	maxIpcChunkBytes: number;
}>;

export type NativeReconciliationSummary = Readonly<{
	inspectedDocuments: number;
	missingDocuments: number;
	corruptDocuments: number;
	unchangedDocuments: number;
}>;

export type NativeImportOptions = Readonly<{
	documentId: string;
	ownerId: string;
	remoteState?: 'pending' | 'synced';
	remoteDocumentId?: string | null;
	driveFileId?: string | null;
	chunkBytes?: number;
	onProgress?: (completedBytes: number, totalBytes: number) => void;
}>;

export type ByteRange = Readonly<{ start: number; endExclusive: number }>;

function positiveSafeInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 1)
		throw new TypeError(`${label} must be a positive integer`);
	return value;
}

export function nativeImportRanges(
	size: number,
	chunkBytes = DEFAULT_CHUNK_BYTES
): readonly ByteRange[] {
	positiveSafeInteger(size, 'size');
	positiveSafeInteger(chunkBytes, 'chunkBytes');
	if (chunkBytes > MAX_SAFE_CHUNK_BYTES) throw new TypeError('chunkBytes exceeds native IPC limit');
	const ranges: ByteRange[] = [];
	for (let start = 0; start < size; start += chunkBytes) {
		ranges.push(Object.freeze({ start, endExclusive: Math.min(size, start + chunkBytes) }));
	}
	return Object.freeze(ranges);
}

function request<T extends Record<string, unknown>>(value: T) {
	return { request: value } as const;
}

function validNativeDocument(value: NativeDocument | null): value is NativeDocument {
	const metadataValid =
		(value?.title === undefined || value.title === null || typeof value.title === 'string') &&
		(value?.notebookId === undefined ||
			value.notebookId === null ||
			typeof value.notebookId === 'string') &&
		(value?.pageCount === undefined ||
			(Number.isSafeInteger(value.pageCount) &&
				value.pageCount >= 1 &&
				value.pageCount <= 10_000)) &&
		(value?.status === undefined || value.status === null || typeof value.status === 'string');
	return (
		value !== null &&
		typeof value.documentId === 'string' &&
		typeof value.ownerId === 'string' &&
		typeof value.originalFilename === 'string' &&
		typeof value.mimeType === 'string' &&
		Number.isSafeInteger(value.sizeBytes) &&
		value.sizeBytes > 0 &&
		typeof value.sha256 === 'string' &&
		value.sha256.length === 64 &&
		metadataValid
	);
}

function validNativeWordGeometry(value: unknown): value is WordGeometry {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Partial<WordGeometry>;
	return (
		typeof row.text === 'string' &&
		row.text.length > 0 &&
		row.text.length <= 256 &&
		row.text === row.text.trim() &&
		Number.isInteger(row.left) &&
		(row.left as number) >= 0 &&
		(row.left as number) <= 10_000 &&
		Number.isInteger(row.top) &&
		(row.top as number) >= 0 &&
		(row.top as number) <= 10_000 &&
		Number.isInteger(row.right) &&
		(row.right as number) > (row.left as number) &&
		(row.right as number) <= 10_000 &&
		Number.isInteger(row.bottom) &&
		(row.bottom as number) > (row.top as number) &&
		(row.bottom as number) <= 10_000
	);
}

function validNativePageWarning(value: unknown): value is PageWarning {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Partial<PageWarning>;
	return (
		typeof row.code === 'string' &&
		/^[a-z][a-z0-9_]{1,63}$/.test(row.code) &&
		typeof row.message === 'string' &&
		row.message.trim().length > 0 &&
		row.message.length <= 300
	);
}

function parseNativeDocumentPageMetadata(value: unknown): NativeDocumentPageMetadata | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const row = value as Partial<NativeDocumentPageMetadata> & {
		wordGeometry?: unknown;
		warnings?: unknown;
	};
	if (!(
		typeof row.documentId === 'string' &&
		row.documentId.length > 0 &&
		row.documentId.length <= 128 &&
		Number.isSafeInteger(row.pageNumber) &&
		(row.pageNumber as number) >= 1 &&
		(row.pageNumber as number) <= 10_000 &&
		(row.nativeText === undefined ||
			row.nativeText === null ||
			(typeof row.nativeText === 'string' && row.nativeText.length <= 1_000_000)) &&
		(row.ocrRawText === undefined ||
			row.ocrRawText === null ||
			(typeof row.ocrRawText === 'string' && row.ocrRawText.length <= 1_000_000)) &&
		(row.correctedText === undefined ||
			row.correctedText === null ||
			(typeof row.correctedText === 'string' && row.correctedText.length <= 1_000_000)) &&
		(row.extractionSource === undefined ||
			row.extractionSource === null ||
			row.extractionSource === 'native_pdf' ||
			row.extractionSource === 'ocr' ||
			row.extractionSource === 'manual') &&
		(row.wordGeometry === undefined ||
			(Array.isArray(row.wordGeometry) &&
				row.wordGeometry.length <= 20_000 &&
				row.wordGeometry.every(validNativeWordGeometry))) &&
		(row.warnings === undefined ||
			(Array.isArray(row.warnings) &&
				row.warnings.length <= 100 &&
				row.warnings.every(validNativePageWarning))) &&
		(row.wasManuallyReviewed === undefined || typeof row.wasManuallyReviewed === 'boolean') &&
		(row.status === 'pending' ||
			row.status === 'processing' ||
			row.status === 'ready' ||
			row.status === 'retryable' ||
			row.status === 'blocked_quota' ||
			row.status === 'needs_review' ||
			row.status === 'failed') &&
		Number.isSafeInteger(row.updatedAtMs) &&
		(row.updatedAtMs as number) >= 0
	)) {
		return null;
	}
	return Object.freeze({
		documentId: row.documentId as string,
		pageNumber: row.pageNumber as number,
		nativeText: row.nativeText ?? null,
		ocrRawText: row.ocrRawText ?? null,
		correctedText: row.correctedText ?? null,
		extractionSource: row.extractionSource ?? null,
		wordGeometry: Object.freeze((row.wordGeometry ?? []) as WordGeometry[]),
		warnings: Object.freeze((row.warnings ?? []) as PageWarning[]),
		wasManuallyReviewed: row.wasManuallyReviewed ?? false,
		status: row.status as NonNullable<NativeDocumentPageMetadata['status']>,
		updatedAtMs: row.updatedAtMs as number
	});
}

function validNativeSearchPage(value: unknown): value is NativeSearchPage {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Partial<NativeSearchPage>;
	return (
		typeof row.documentId === 'string' &&
		row.documentId.length > 0 &&
		row.documentId.length <= 128 &&
		typeof row.documentTitle === 'string' &&
		row.documentTitle.length <= 240 &&
		(row.notebookId === null ||
			(typeof row.notebookId === 'string' && row.notebookId.length <= 128)) &&
		Number.isSafeInteger(row.pageNumber) &&
		(row.pageNumber as number) >= 1 &&
		(row.pageNumber as number) <= 10_000 &&
		typeof row.nativeText === 'string' &&
		row.nativeText.length > 0 &&
		row.nativeText.length <= 1_000_000 &&
		typeof row.rank === 'number' &&
		Number.isFinite(row.rank) &&
		row.rank >= 0
	);
}

function validNativeDocumentPageCursor(value: unknown): value is NativeDocumentPageCursor {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Number.isSafeInteger((value as NativeDocumentPageCursor).lastAccessedAtMs) &&
		(value as NativeDocumentPageCursor).lastAccessedAtMs >= 0 &&
		typeof (value as NativeDocumentPageCursor).documentId === 'string' &&
		(value as NativeDocumentPageCursor).documentId.length > 0 &&
		(value as NativeDocumentPageCursor).documentId.length <= 128
	);
}

function parseNativeReconciliationSummary(value: unknown): NativeReconciliationSummary {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid native reconciliation summary');
	}
	const row = value as Record<keyof NativeReconciliationSummary, unknown>;
	const counts = [
		row.inspectedDocuments,
		row.missingDocuments,
		row.corruptDocuments,
		row.unchangedDocuments
	];
	if (
		!counts.every((count) => Number.isSafeInteger(count) && (count as number) >= 0) ||
		(row.missingDocuments as number) +
			(row.corruptDocuments as number) +
			(row.unchangedDocuments as number) >
			(row.inspectedDocuments as number)
	) {
		throw new TypeError('Invalid native reconciliation summary');
	}
	return Object.freeze({
		inspectedDocuments: row.inspectedDocuments as number,
		missingDocuments: row.missingDocuments as number,
		corruptDocuments: row.corruptDocuments as number,
		unchangedDocuments: row.unchangedDocuments as number
	});
}

function parseNativeDocumentPage(value: unknown): NativeDocumentPage {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid native document page');
	}
	const row = value as { documents?: unknown; nextCursor?: unknown };
	if (
		!Array.isArray(row.documents) ||
		!row.documents.every((document) => validNativeDocument(document as NativeDocument | null)) ||
		(row.nextCursor !== null && !validNativeDocumentPageCursor(row.nextCursor))
	) {
		throw new TypeError('Invalid native document page');
	}
	return Object.freeze({
		documents: Object.freeze(row.documents as NativeDocument[]),
		nextCursor: row.nextCursor as NativeDocumentPageCursor | null
	});
}

export async function getNativeStatus(): Promise<NativeStatus | null> {
	if (!isNativeRuntime()) return null;
	return await invokeNative<NativeStatus>('native_status');
}

export async function reconcileNativeDocuments(
	fullHash = false
): Promise<NativeReconciliationSummary | null> {
	if (!isNativeRuntime()) return null;
	const result = await invokeNative<unknown>('reconcile_native_documents', request({ fullHash }));
	return parseNativeReconciliationSummary(result);
}

export async function listNativeDocumentsPage(
	options: {
		limit?: number;
		cursor?: NativeDocumentPageCursor | null;
	} = {}
): Promise<NativeDocumentPage | null> {
	if (!isNativeRuntime()) return null;
	const limit = options.limit ?? 200;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
		throw new TypeError('Invalid native document page limit');
	}
	if (options.cursor !== undefined && options.cursor !== null) {
		if (!validNativeDocumentPageCursor(options.cursor)) {
			throw new TypeError('Invalid native document page cursor');
		}
	}
	const result = await invokeNative<unknown>(
		'list_native_documents_page',
		request({ limit, cursor: options.cursor ?? null })
	);
	return parseNativeDocumentPage(result);
}

export async function resolveNativeDocument(documentId: string): Promise<NativeDocument | null> {
	if (!isNativeRuntime()) return null;
	const result = await invokeNative<NativeDocument | null>(
		'get_local_document',
		request({ documentId })
	);
	return validNativeDocument(result) ? result : null;
}

export async function resolveNativeDocumentByDriveFileId(
	driveFileId: string
): Promise<NativeDocument | null> {
	if (!isNativeRuntime()) return null;
	const result = await invokeNative<NativeDocument | null>(
		'get_local_document_by_drive_file_id',
		request({ driveFileId })
	);
	return validNativeDocument(result) ? result : null;
}

export async function listNativeDocumentPages(
	documentId: string,
	ownerId: string
): Promise<readonly NativeDocumentPageMetadata[] | null> {
	if (!isNativeRuntime()) return null;
	if (ownerId.trim().length === 0 || ownerId.length > 128) {
		throw new TypeError('Invalid native document owner');
	}
	const result = await invokeNative<unknown>(
		'list_native_document_pages',
		request({ documentId, ownerId })
	);
	if (!Array.isArray(result)) {
		throw new TypeError('Invalid native document page metadata');
	}
	const pages = result.map(parseNativeDocumentPageMetadata);
	if (pages.some((page) => page === null)) {
		throw new TypeError('Invalid native document page metadata');
	}
	return Object.freeze(pages as NativeDocumentPageMetadata[]);
}

export async function updateNativeDocumentMetadata(
	input: NativeDocumentMetadataInput
): Promise<void> {
	if (!isNativeRuntime()) return;
	if (input.ownerId.trim().length === 0 || input.ownerId.length > 128) {
		throw new TypeError('Invalid native document owner');
	}
	if (input.title.trim().length === 0 || input.title.length > 240) {
		throw new TypeError('Invalid native document title');
	}
	if (!Number.isSafeInteger(input.pageCount) || input.pageCount < 1 || input.pageCount > 10_000) {
		throw new TypeError('Invalid native document page count');
	}
	const pages = input.pages;
	const seen = new Set<number>();
	for (const page of pages) {
		const wordGeometry = page.wordGeometry ?? [];
		const warnings = page.warnings ?? [];
		if (
			!Number.isSafeInteger(page.pageNumber) ||
			page.pageNumber < 1 ||
			page.pageNumber > input.pageCount ||
			seen.has(page.pageNumber) ||
			(page.nativeText !== null && page.nativeText.length > 1_000_000) ||
			(page.ocrRawText !== undefined &&
				page.ocrRawText !== null &&
				page.ocrRawText.length > 1_000_000) ||
			(page.correctedText !== undefined &&
				page.correctedText !== null &&
				page.correctedText.length > 1_000_000) ||
			(page.extractionSource !== undefined &&
				page.extractionSource !== null &&
				!['native_pdf', 'ocr', 'manual'].includes(page.extractionSource)) ||
			wordGeometry.length > 20_000 ||
			!wordGeometry.every(validNativeWordGeometry) ||
			warnings.length > 100 ||
			!warnings.every(validNativePageWarning)
		) {
			throw new TypeError('Invalid native page metadata');
		}
		seen.add(page.pageNumber);
	}
	await invokeNative<void>(
		'update_native_document_metadata',
		request({
			documentId: input.documentId,
			ownerId: input.ownerId,
			title: input.title.trim(),
			notebookId: input.notebookId ?? null,
			pageCount: input.pageCount,
			status: input.status,
			pages: pages.map((page) => ({
				pageNumber: page.pageNumber,
				nativeText: page.nativeText,
				ocrRawText: page.ocrRawText ?? null,
				correctedText: page.correctedText ?? null,
				extractionSource: page.extractionSource ?? null,
				wordGeometry: page.wordGeometry ?? [],
				warnings: page.warnings ?? [],
				wasManuallyReviewed: page.wasManuallyReviewed ?? false
			}))
		})
	);
}

export async function updateNativeDocumentPageMetadata(input: {
	documentId: string;
	ownerId: string;
	status: ProcessingStatus;
	page: {
		pageNumber: number;
		nativeText: string | null;
		ocrRawText?: string | null;
		correctedText?: string | null;
		extractionSource?: ExtractionSource | null;
		wordGeometry?: readonly WordGeometry[];
		warnings?: readonly PageWarning[];
		wasManuallyReviewed?: boolean;
	};
}): Promise<void> {
	if (!isNativeRuntime()) return;
	if (input.ownerId.trim().length === 0 || input.ownerId.length > 128) {
		throw new TypeError('Invalid native document owner');
	}
	const page = input.page;
	const wordGeometry = page.wordGeometry ?? [];
	const warnings = page.warnings ?? [];
	if (
		!Number.isSafeInteger(page.pageNumber) ||
		page.pageNumber < 1 ||
		page.pageNumber > 10_000 ||
		(page.nativeText !== null && page.nativeText.length > 1_000_000) ||
		(page.ocrRawText !== undefined &&
			page.ocrRawText !== null &&
			page.ocrRawText.length > 1_000_000) ||
		(page.correctedText !== undefined &&
			page.correctedText !== null &&
			page.correctedText.length > 1_000_000) ||
		(page.extractionSource !== undefined &&
			page.extractionSource !== null &&
			!['native_pdf', 'ocr', 'manual'].includes(page.extractionSource)) ||
		wordGeometry.length > 20_000 ||
		!wordGeometry.every(validNativeWordGeometry) ||
		warnings.length > 100 ||
		!warnings.every(validNativePageWarning)
	) {
		throw new TypeError('Invalid native page metadata');
	}
	await invokeNative<void>(
		'update_native_document_page_metadata',
		request({
			documentId: input.documentId,
			ownerId: input.ownerId,
			status: input.status,
			page: {
				pageNumber: page.pageNumber,
				nativeText: page.nativeText,
				ocrRawText: page.ocrRawText ?? null,
				correctedText: page.correctedText ?? null,
				extractionSource: page.extractionSource ?? null,
				wordGeometry,
				warnings,
				wasManuallyReviewed: page.wasManuallyReviewed ?? false
			}
		})
	);
}

export async function searchNativeDocumentPages(options: {
	ownerId: string;
	query: string;
	notebookId?: string | null;
	limit?: number;
	offset?: number;
}): Promise<readonly NativeSearchPage[] | null> {
	if (!isNativeRuntime()) return null;
	if (options.ownerId.trim().length === 0 || options.ownerId.length > 128) {
		throw new TypeError('Invalid native document owner');
	}
	if (options.query.trim().length === 0 || options.query.length > 200) {
		throw new TypeError('Invalid native search query');
	}
	const limit = options.limit ?? 30;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new TypeError('Invalid native search limit');
	}
	const offset = options.offset ?? 0;
	if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
		throw new TypeError('Invalid native search offset');
	}
	const result = await invokeNative<unknown>(
		'search_native_document_pages',
		request({
			ownerId: options.ownerId,
			query: options.query.trim(),
			notebookId: options.notebookId ?? null,
			limit,
			offset
		})
	);
	if (!Array.isArray(result) || !result.every(validNativeSearchPage)) {
		throw new TypeError('Invalid native search result');
	}
	return Object.freeze(result as NativeSearchPage[]);
}

export async function importFileIntoNativeStore(
	file: File,
	options: NativeImportOptions
): Promise<NativeDocument | null> {
	if (!isNativeRuntime()) return null;
	if (!(file instanceof Blob) || file.size < 1) throw new TypeError('A non-empty file is required');
	const status = await getNativeStatus();
	const maximum = status?.maxDocumentBytes ?? 2 * 1024 * 1024 * 1024;
	if (file.size > maximum) throw new Error('O arquivo excede o limite do armazenamento local.');
	const chunkBytes = Math.min(
		options.chunkBytes ?? DEFAULT_CHUNK_BYTES,
		status?.maxIpcChunkBytes ?? MAX_SAFE_CHUNK_BYTES,
		MAX_SAFE_CHUNK_BYTES
	);
	const ranges = nativeImportRanges(file.size, chunkBytes);
	await invokeNative<void>(
		'begin_local_import',
		request({
			documentId: options.documentId,
			ownerId: options.ownerId,
			originalFilename: file.name || 'documento',
			mimeType: file.type || 'application/octet-stream',
			expectedSize: file.size,
			remoteState: options.remoteState ?? 'pending',
			remoteDocumentId: options.remoteDocumentId ?? null,
			driveFileId: options.driveFileId ?? null
		})
	);
	try {
		for (const range of ranges) {
			const bytes = new Uint8Array(await file.slice(range.start, range.endExclusive).arrayBuffer());
			try {
				await invokeNative<number>(
					'append_local_import',
					request({ documentId: options.documentId, chunk: Array.from(bytes) })
				);
			} finally {
				bytes.fill(0);
			}
			options.onProgress?.(range.endExclusive, file.size);
		}
		const document = await invokeNative<NativeDocument>(
			'finish_local_import',
			request({ documentId: options.documentId })
		);
		if (!validNativeDocument(document))
			throw new Error('O runtime nativo retornou um documento inválido.');
		return document;
	} catch (error) {
		await invokeNative<void>(
			'abort_local_import',
			request({ documentId: options.documentId })
		).catch(() => undefined);
		throw error;
	}
}

export async function cacheRemoteFileInNativeStore(
	file: File,
	options: Omit<NativeImportOptions, 'remoteState'>
): Promise<NativeDocument | null> {
	if (!isNativeRuntime()) return null;
	const existing = await resolveNativeDocument(options.documentId);
	if (existing?.localState === 'present' && existing.sizeBytes === file.size) {
		await markNativeDocumentRemoteSynced({
			documentId: options.documentId,
			remoteDocumentId: options.remoteDocumentId,
			driveFileId: options.driveFileId
		});
		return (await resolveNativeDocument(options.documentId)) ?? existing;
	}
	return await importFileIntoNativeStore(file, { ...options, remoteState: 'synced' });
}

export async function readNativeDocumentRange(
	documentId: string,
	start: number,
	endExclusive: number
): Promise<Uint8Array<ArrayBuffer>> {
	if (!isNativeRuntime()) throw new Error('O documento não está em um runtime nativo.');
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(endExclusive) ||
		start < 0 ||
		endExclusive <= start ||
		endExclusive - start > MAX_SAFE_CHUNK_BYTES
	) {
		throw new TypeError('Invalid native document range');
	}
	const raw = await invokeNative<ArrayBuffer>(
		'read_local_document_range',
		request({ documentId, start, endExclusive })
	);
	const bytes = new Uint8Array(raw.slice(0));
	if (bytes.byteLength !== endExclusive - start) {
		bytes.fill(0);
		throw new Error('O runtime nativo retornou uma faixa incompleta.');
	}
	return bytes;
}

export async function readNativeDocumentBlob(document: NativeDocument): Promise<Blob> {
	const parts: BlobPart[] = [];
	for (const range of nativeImportRanges(document.sizeBytes, DEFAULT_CHUNK_BYTES)) {
		const bytes = await readNativeDocumentRange(
			document.documentId,
			range.start,
			range.endExclusive
		);
		parts.push(bytes.buffer);
	}
	return new Blob(parts, { type: document.mimeType });
}

export async function readNativeOriginal(
	documentId: string,
	expectedMime: string,
	maximumBytes: number
): Promise<Blob | null> {
	if (!isNativeRuntime()) return null;
	if (expectedMime.length === 0 || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
		throw new TypeError('Invalid native original constraints');
	}
	let document: NativeDocument | null;
	try {
		document = await resolveNativeDocument(documentId);
	} catch {
		return null;
	}
	const mimeMatches = expectedMime.endsWith('/*')
		? document?.mimeType.startsWith(expectedMime.slice(0, -1))
		: document?.mimeType === expectedMime;
	if (
		!document ||
		document.localState !== 'present' ||
		!mimeMatches ||
		document.sizeBytes > maximumBytes
	) {
		return null;
	}
	try {
		const blob = await readNativeDocumentBlob(document);
		return blob.size === document.sizeBytes ? blob : null;
	} catch {
		return null;
	}
}

export async function verifyNativeDocument(documentId: string, fullHash = false) {
	if (!isNativeRuntime()) return false;
	return await invokeNative<boolean>('verify_local_document', request({ documentId, fullHash }));
}

export async function markNativeDocumentRemoteSynced(options: {
	documentId: string;
	remoteDocumentId?: string | null;
	driveFileId?: string | null;
}) {
	if (!isNativeRuntime()) return;
	await invokeNative<void>(
		'mark_native_remote_synced',
		request({
			documentId: options.documentId,
			remoteDocumentId: options.remoteDocumentId ?? null,
			driveFileId: options.driveFileId ?? null
		})
	);
}
