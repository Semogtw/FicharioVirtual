import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { mapPageRecord, type PageDetail, type PageRecord } from '$lib/domain/page';
import {
	listNativeDocumentPages,
	resolveNativeDocument,
	updateNativeDocumentPageMetadata,
	type NativeDocument,
	type NativeDocumentPageMetadata
} from '$lib/native/local-document-store';
import { openNativePdfRangeDocument } from '$lib/pdf/native-range-transport';
import { isNativeRuntime } from '$lib/platform/native-bridge';
import { sessionState } from '$lib/stores/session.svelte';
import type {
	Database,
	DocumentKind,
	DocumentStatus,
	DrivePhysicalState,
	ProcessingStatus
} from '$lib/types/database';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAGE_TEXT_LENGTH = 1_000_000;
const DETAIL_CACHE_TTL_MS = 60_000;
const PAGE_CACHE_TTL_MS = 120_000;
const DETAIL_CACHE_MAX_ENTRIES = 40;
const PAGE_CACHE_MAX_ENTRIES = 120;
const timestamp = z.string().refine(isIsoTimestamp);
const processingStatusSchema = z.enum([
	'pending',
	'processing',
	'ready',
	'retryable',
	'blocked_quota',
	'needs_review',
	'failed'
]);
const warningSchema = z
	.object({
		code: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
		message: z
			.string()
			.max(300)
			.refine((value) => value.trim().length > 0)
	})
	.strict();
const wordGeometrySchema = z
	.array(
		z.tuple([
			z.string().trim().min(1).max(256),
			z.number().int().min(0).max(10_000),
			z.number().int().min(0).max(10_000),
			z.number().int().min(0).max(10_000),
			z.number().int().min(0).max(10_000)
		])
	)
	.max(20_000);
const driveFileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,256}$/);
const pageRecordSchema = z
	.object({
		id: z.string().regex(UUID),
		page_number: z.number().int().min(1).max(10_000),
		native_text: z.string().max(MAX_PAGE_TEXT_LENGTH).nullable(),
		ocr_raw_text: z.string().max(MAX_PAGE_TEXT_LENGTH).nullable(),
		corrected_text: z.string().max(MAX_PAGE_TEXT_LENGTH).nullable(),
		extraction_source: z.enum(['native_pdf', 'ocr', 'manual']).nullable(),
		source_drive_file_id: driveFileIdSchema.nullable().optional(),
		ocr_word_geometry: wordGeometrySchema.optional().default([]),
		warnings: z.array(warningSchema).max(100),
		status: processingStatusSchema,
		was_manually_reviewed: z.boolean(),
		updated_at: timestamp
	})
	.strict();
const pageSummaryRecordSchema = z
	.object({
		id: z.string().regex(UUID),
		page_number: z.number().int().min(1).max(10_000),
		source_drive_file_id: driveFileIdSchema.nullable().optional(),
		status: processingStatusSchema,
		updated_at: timestamp
	})
	.strict();
const pageSummaryRecordsSchema = z.array(pageSummaryRecordSchema).max(10_000);
const documentRecordSchema = z
	.object({
		id: z.string().regex(UUID),
		title: z.string().trim().min(1).max(240),
		kind: z.enum(['image', 'pdf']),
		status: z.enum(['processing', 'partially_ready', 'ready', 'needs_review', 'failed']),
		page_count: z.number().int().min(0).max(10_000),
		notebook_id: z.string().regex(UUID).nullable(),
		original_filename: z.string().min(1).max(512),
		storage_path: z.string().min(1).max(1_024).nullable(),
		drive_file_id: driveFileIdSchema.nullable().optional(),
		physical_state: z.enum(['available', 'missing', 'reconnecting']).optional(),
		created_at: timestamp,
		updated_at: timestamp
	})
	.strict();

export type DocumentDetailRecord = {
	id: string;
	title: string;
	kind: DocumentKind;
	status: DocumentStatus;
	page_count: number;
	notebook_id: string | null;
	original_filename: string;
	storage_path: string | null;
	drive_file_id?: string | null;
	physical_state?: DrivePhysicalState;
	created_at: string;
	updated_at: string;
};

export type DocumentPageSummaryRecord = {
	id: string;
	page_number: number;
	source_drive_file_id?: string | null;
	status: ProcessingStatus;
	updated_at: string;
};

export type DocumentPageSummary = Readonly<{
	id: string;
	pageNumber: number;
	sourceDriveFileId: string | null;
	status: ProcessingStatus;
	updatedAt: string;
}>;

export type DocumentOriginalReference =
	| Readonly<{
			provider: 'supabase';
			url: string;
			driveFileId: string | null;
	  }>
	| Readonly<{
			provider: 'google_drive';
			url: string;
			driveFileId: string;
	  }>
	| Readonly<{
			provider: 'missing';
			url: null;
			driveFileId: string | null;
	  }>;

export type DocumentDetail = {
	id: string;
	title: string;
	kind: DocumentKind;
	status: DocumentStatus;
	pageCount: number;
	notebookId: string | null;
	originalFilename: string;
	originalUrl: string | null;
	originalReference: DocumentOriginalReference;
	physicalState: DrivePhysicalState;
	pages: readonly DocumentPageSummary[];
	createdAt: string;
	updatedAt: string;
};

export type DocumentPreview = Readonly<{
	detail: DocumentDetail;
	page: PageDetail;
}>;

export interface DocumentDetailGateway {
	loadDocument(documentId: string): Promise<DocumentDetailRecord | null>;
	listPageSummaries(documentId: string): Promise<readonly DocumentPageSummaryRecord[]>;
	loadPage(documentId: string, pageNumber: number): Promise<PageRecord | null>;
	createSignedUrl(storagePath: string): Promise<string>;
}

export class DocumentDetailError extends Error {
	readonly code: 'not_found' | 'unavailable';

	constructor(code: DocumentDetailError['code']) {
		const messages = {
			not_found: 'Este documento não existe ou não está disponível.',
			unavailable: 'Não foi possível abrir o documento agora.'
		} as const;
		super(messages[code]);
		this.name = 'DocumentDetailError';
		this.code = code;
	}
}

type TimedCacheEntry<T> = Readonly<{ expiresAt: number; value: T }>;
const detailCache = new Map<string, TimedCacheEntry<DocumentDetail>>();
const detailInflight = new Map<string, Promise<DocumentDetail>>();
const previewCache = new Map<string, TimedCacheEntry<DocumentPreview>>();
const previewInflight = new Map<string, Promise<DocumentPreview>>();
const pageCache = new Map<string, TimedCacheEntry<PageDetail>>();
const pageInflight = new Map<string, Promise<PageDetail>>();

function validId(value: string, label: string) {
	if (!UUID.test(value)) throw new TypeError(`Invalid ${label} identifier`);
	return value;
}

function validPageNumber(value: number) {
	if (!Number.isInteger(value) || value < 1 || value > 10_000) {
		throw new TypeError('Invalid page number');
	}
	return value;
}

function signedUrl(value: string) {
	const parsed = new URL(value);
	if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('Invalid signed URL');
	return value;
}

function detailCacheKey(userId: string, documentId: string) {
	return `${userId}:${documentId}`;
}

function pageCacheKey(userId: string, documentId: string, pageNumber: number) {
	return `${userId}:${documentId}:${pageNumber}`;
}

async function currentCacheUserId(client: SupabaseClient<Database>) {
	try {
		const { data, error } = await client.auth.getSession();
		const userId = data.session?.user.id;
		return !error && typeof userId === 'string' && UUID.test(userId) ? userId : null;
	} catch {
		return null;
	}
}

function getCached<T>(cache: Map<string, TimedCacheEntry<T>>, key: string) {
	const entry = cache.get(key);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		cache.delete(key);
		return null;
	}
	cache.delete(key);
	cache.set(key, entry);
	return entry.value;
}

function putCached<T>(
	cache: Map<string, TimedCacheEntry<T>>,
	key: string,
	value: T,
	ttlMs: number,
	maximumEntries: number
) {
	cache.set(key, Object.freeze({ expiresAt: Date.now() + ttlMs, value }));
	while (cache.size > maximumEntries) {
		const oldest = cache.keys().next().value;
		if (typeof oldest !== 'string') break;
		cache.delete(oldest);
	}
}

export function driveReferenceUrl(driveFileId: string): string {
	if (!driveFileIdSchema.safeParse(driveFileId).success) {
		throw new TypeError('Invalid Google Drive file identifier');
	}
	return `https://drive.google.com/file/d/${driveFileId}/view`;
}

async function resolveOriginalReference(
	document: z.infer<typeof documentRecordSchema>,
	gateway: DocumentDetailGateway
) {
	const physicalState: DrivePhysicalState = document.physical_state ?? 'available';
	const driveFileId = document.drive_file_id ?? null;
	if (document.storage_path !== null) {
		const url = signedUrl(await gateway.createSignedUrl(document.storage_path));
		return Object.freeze({ provider: 'supabase' as const, url, driveFileId });
	}
	if (physicalState !== 'available' || driveFileId === null) {
		return Object.freeze({ provider: 'missing' as const, url: null, driveFileId });
	}
	return Object.freeze({
		provider: 'google_drive' as const,
		url: driveReferenceUrl(driveFileId),
		driveFileId
	});
}

function preserveNotFound(error: unknown): never {
	if (error instanceof DocumentDetailError && error.code === 'not_found') throw error;
	throw new DocumentDetailError('unavailable');
}

function mapPageSummary(record: z.infer<typeof pageSummaryRecordSchema>): DocumentPageSummary {
	return Object.freeze({
		id: record.id,
		pageNumber: record.page_number,
		sourceDriveFileId: record.source_drive_file_id ?? null,
		status: record.status,
		updatedAt: record.updated_at
	});
}

function nativeTimestamp(value: number) {
	if (!Number.isSafeInteger(value) || value < 0) return null;
	try {
		const result = new Date(value).toISOString();
		return isIsoTimestamp(result) ? result : null;
	} catch {
		return null;
	}
}

function nativeTitle(filename: string) {
	return (
		filename
			.replace(/\.[^.]+$/u, '')
			.trim()
			.slice(0, 240) || 'Documento local'
	);
}

function nativeMetadataTitle(document: NativeDocument) {
	const title = document.title?.trim();
	return title ? title.slice(0, 240) : nativeTitle(document.originalFilename);
}

function nativePageCount(document: NativeDocument, fallback: number) {
	const pageCount = document.pageCount;
	if (
		document.status !== null &&
		document.status !== undefined &&
		typeof pageCount === 'number' &&
		Number.isSafeInteger(pageCount) &&
		pageCount >= 1 &&
		pageCount <= 10_000
	) {
		return pageCount;
	}
	return Number.isSafeInteger(fallback) && fallback >= 1 && fallback <= 10_000 ? fallback : 1;
}

function nativeDocumentStatus(document: NativeDocument): DocumentStatus {
	if (document.localState !== 'present') return 'failed';
	if (document.remoteState === 'pending') return 'pending';
	if (
		document.status === 'processing' ||
		document.status === 'partially_ready' ||
		document.status === 'ready' ||
		document.status === 'needs_review' ||
		document.status === 'failed'
	) {
		return document.status;
	}
	return 'ready';
}

function nativePageUpdatedAt(
	document: NativeDocument,
	page: NativeDocumentPageMetadata | undefined
) {
	return (
		nativeTimestamp(page?.updatedAtMs ?? document.updatedAtMs) ??
		nativeTimestamp(document.createdAtMs) ??
		new Date(0).toISOString()
	);
}

function mapNativePageDetail(
	document: NativeDocument,
	pageNumber: number,
	page: NativeDocumentPageMetadata | undefined
): PageDetail {
	const fallbackStatus: ProcessingStatus =
		nativeDocumentStatus(document) === 'pending'
			? 'pending'
			: document.localState === 'present'
				? 'ready'
				: 'failed';
	return mapPageRecord({
		id: `${document.documentId}:native:${pageNumber}`,
		page_number: pageNumber,
		native_text: page?.nativeText ?? null,
		ocr_raw_text: page?.ocrRawText ?? null,
		corrected_text: page?.correctedText ?? null,
		extraction_source: page?.extractionSource ?? (page?.nativeText ? 'native_pdf' : null),
		source_drive_file_id: null,
		ocr_word_geometry:
			page?.wordGeometry?.map((word) => [
				word.text,
				word.left,
				word.top,
				word.right,
				word.bottom
			]) ?? [],
		warnings: page?.warnings ? [...page.warnings] : [],
		status: page?.status ?? fallbackStatus,
		was_manually_reviewed: page?.wasManuallyReviewed ?? false,
		updated_at: nativePageUpdatedAt(document, page)
	});
}

function nativeKind(mimeType: string): DocumentKind | null {
	if (mimeType === 'application/pdf') return 'pdf';
	if (mimeType.startsWith('image/')) return 'image';
	return null;
}

export function mapNativeDocumentDetail(
	document: NativeDocument,
	pageCount = 1,
	pageMetadata: readonly NativeDocumentPageMetadata[] = []
): DocumentDetail | null {
	const kind = nativeKind(document.mimeType);
	const createdAt = nativeTimestamp(document.createdAtMs);
	const updatedAt = nativeTimestamp(document.updatedAtMs);
	const normalizedPageCount = nativePageCount(document, pageCount);
	if (!kind || !createdAt || !updatedAt) return null;
	const driveFileId = document.driveFileId;
	const originalReference =
		driveFileId && driveFileIdSchema.safeParse(driveFileId).success
			? Object.freeze({
					provider: 'google_drive' as const,
					url: driveReferenceUrl(driveFileId),
					driveFileId
				})
			: Object.freeze({ provider: 'missing' as const, url: null, driveFileId: null });
	const pageByNumber = new Map(pageMetadata.map((page) => [page.pageNumber, page] as const));
	const documentStatus = nativeDocumentStatus(document);
	const defaultPageStatus: ProcessingStatus =
		documentStatus === 'pending'
			? 'pending'
			: documentStatus === 'ready'
				? 'ready'
				: documentStatus === 'failed'
					? 'failed'
					: 'processing';
	return Object.freeze({
		id: document.documentId,
		title: nativeMetadataTitle(document),
		kind,
		status: documentStatus,
		pageCount: normalizedPageCount,
		notebookId: document.notebookId ?? null,
		originalFilename: document.originalFilename,
		originalUrl: originalReference.url,
		originalReference,
		physicalState: document.localState === 'present' ? 'available' : 'missing',
		pages: Object.freeze(
			Array.from({ length: normalizedPageCount }, (_, index) => {
				const page = pageByNumber.get(index + 1);
				return Object.freeze({
					id: `${document.documentId}:native:${index + 1}`,
					pageNumber: index + 1,
					sourceDriveFileId: null,
					status: page?.status ?? defaultPageStatus,
					updatedAt: nativePageUpdatedAt(document, page)
				});
			})
		),
		createdAt,
		updatedAt
	});
}

async function loadNativeDocumentDetail(documentId: string): Promise<DocumentDetail | null> {
	if (!isNativeRuntime()) return null;
	const ownerId = sessionState.user?.id;
	if (!ownerId) return null;
	try {
		const local = await resolveNativeDocument(documentId);
		if (!local || local.ownerId !== ownerId) return null;
		let pageCount = local.pageCount ?? 1;
		let pageMetadata: readonly NativeDocumentPageMetadata[] = [];
		try {
			pageMetadata = (await listNativeDocumentPages(local.documentId, ownerId)) ?? [];
		} catch {
			pageMetadata = [];
		}
		if (local.localState === 'present' && local.mimeType === 'application/pdf') {
			try {
				const opened = await openNativePdfRangeDocument({
					documentId: local.documentId,
					totalBytes: local.sizeBytes
				});
				try {
					if (Number.isSafeInteger(opened.document.numPages) && opened.document.numPages > 0) {
						pageCount = Math.min(opened.document.numPages, 10_000);
					}
				} finally {
					await opened.destroy();
				}
			} catch {
				// Keep a one-page shell; the viewer will surface a precise render error if needed.
			}
		}
		return mapNativeDocumentDetail(local, pageCount, pageMetadata);
	} catch {
		return null;
	}
}

async function loadNativeDocumentPage(
	documentId: string,
	pageNumber: number
): Promise<PageDetail | null> {
	if (!isNativeRuntime()) return null;
	const ownerId = sessionState.user?.id;
	if (!ownerId) return null;
	try {
		const document = await resolveNativeDocument(documentId);
		if (!document || document.ownerId !== ownerId) return null;
		const pages = (await listNativeDocumentPages(documentId, ownerId)) ?? [];
		const page = pages.find((candidate) => candidate.pageNumber === pageNumber);
		return mapNativePageDetail(document, pageNumber, page);
	} catch {
		return null;
	}
}

async function cacheRemotePageMetadata(
	documentId: string,
	page: PageRecord,
	mappedPage: PageDetail
) {
	if (!isNativeRuntime()) return;
	const ownerId = sessionState.user?.id;
	if (!ownerId) return;
	try {
		const local = await resolveNativeDocument(documentId);
		if (!local || local.ownerId !== ownerId) return;
		await updateNativeDocumentPageMetadata({
			documentId,
			ownerId,
			status: mappedPage.status,
			page: {
				pageNumber: mappedPage.pageNumber,
				nativeText: mappedPage.nativeText,
				ocrRawText: mappedPage.ocrRawText,
				correctedText: mappedPage.correctedText,
				extractionSource: mappedPage.extractionSource,
				wordGeometry: mappedPage.wordGeometry,
				warnings: mappedPage.warnings,
				wasManuallyReviewed: mappedPage.wasManuallyReviewed
			}
		});
	} catch {
		// Remote detail remains authoritative if the local metadata cache is unavailable.
	}
}

async function loadNativeDocumentPreview(
	documentId: string,
	pageNumber: number
): Promise<DocumentPreview | null> {
	const detail = await loadNativeDocumentDetail(documentId);
	if (!detail) return null;
	const page = await loadNativeDocumentPage(documentId, pageNumber);
	if (!page) return null;
	return Object.freeze({ detail, page });
}

export async function loadDocumentDetailWithGateway(
	documentId: string,
	gateway: DocumentDetailGateway
): Promise<DocumentDetail> {
	const validatedDocumentId = validId(documentId, 'document');
	try {
		const rawDocument = await gateway.loadDocument(validatedDocumentId);
		if (rawDocument === null) throw new DocumentDetailError('not_found');
		const document = documentRecordSchema.parse(rawDocument);
		if (document.id !== validatedDocumentId) throw new DocumentDetailError('unavailable');
		const [rawPages, originalReference] = await Promise.all([
			gateway.listPageSummaries(validatedDocumentId),
			resolveOriginalReference(document, gateway)
		]);
		const pages = pageSummaryRecordsSchema.parse(rawPages);
		if (pages.length !== document.page_count) throw new DocumentDetailError('unavailable');
		const pageIds = new Set<string>();
		const pageNumbers = new Set<number>();
		for (const page of pages) {
			if (
				page.page_number > document.page_count ||
				pageIds.has(page.id) ||
				pageNumbers.has(page.page_number)
			) {
				throw new DocumentDetailError('unavailable');
			}
			pageIds.add(page.id);
			pageNumbers.add(page.page_number);
		}
		return Object.freeze({
			id: document.id,
			title: document.title,
			kind: document.kind,
			status: document.status,
			pageCount: document.page_count,
			notebookId: document.notebook_id,
			originalFilename: document.original_filename,
			originalUrl: originalReference.url,
			originalReference,
			physicalState: document.physical_state ?? 'available',
			pages: Object.freeze(
				pages.map(mapPageSummary).sort((left, right) => left.pageNumber - right.pageNumber)
			),
			createdAt: document.created_at,
			updatedAt: document.updated_at
		});
	} catch (error) {
		preserveNotFound(error);
	}
}

export async function loadDocumentPreviewWithGateway(
	documentId: string,
	pageNumber: number,
	gateway: DocumentDetailGateway
): Promise<DocumentPreview> {
	const validatedDocumentId = validId(documentId, 'document');
	const validatedPageNumber = validPageNumber(pageNumber);
	try {
		const rawDocument = await gateway.loadDocument(validatedDocumentId);
		if (rawDocument === null) throw new DocumentDetailError('not_found');
		const document = documentRecordSchema.parse(rawDocument);
		if (document.id !== validatedDocumentId) throw new DocumentDetailError('unavailable');
		const [rawPage, originalReference] = await Promise.all([
			gateway.loadPage(validatedDocumentId, validatedPageNumber),
			resolveOriginalReference(document, gateway)
		]);
		if (rawPage === null) throw new DocumentDetailError('not_found');
		const page = pageRecordSchema.parse(rawPage);
		if (page.page_number !== validatedPageNumber) throw new DocumentDetailError('unavailable');
		const mappedPage = mapPageRecord(page);
		void cacheRemotePageMetadata(validatedDocumentId, page, mappedPage);
		const detail = Object.freeze({
			id: document.id,
			title: document.title,
			kind: document.kind,
			status: document.status,
			pageCount: document.page_count,
			notebookId: document.notebook_id,
			originalFilename: document.original_filename,
			originalUrl: originalReference.url,
			originalReference,
			physicalState: document.physical_state ?? 'available',
			pages: Object.freeze([
				mapPageSummary({
					id: page.id,
					page_number: page.page_number,
					source_drive_file_id: page.source_drive_file_id ?? null,
					status: page.status,
					updated_at: page.updated_at
				})
			]),
			createdAt: document.created_at,
			updatedAt: document.updated_at
		});
		return Object.freeze({ detail, page: mappedPage });
	} catch (error) {
		preserveNotFound(error);
	}
}

export async function loadDocumentPageWithGateway(
	documentId: string,
	pageNumber: number,
	gateway: DocumentDetailGateway
): Promise<PageDetail> {
	const validatedDocumentId = validId(documentId, 'document');
	const validatedPageNumber = validPageNumber(pageNumber);
	try {
		const rawPage = await gateway.loadPage(validatedDocumentId, validatedPageNumber);
		if (rawPage === null) throw new DocumentDetailError('not_found');
		const page = pageRecordSchema.parse(rawPage);
		if (page.page_number !== validatedPageNumber) throw new DocumentDetailError('unavailable');
		const mappedPage = mapPageRecord(page);
		void cacheRemotePageMetadata(validatedDocumentId, page, mappedPage);
		return mappedPage;
	} catch (error) {
		preserveNotFound(error);
	}
}

class SupabaseDocumentGateway implements DocumentDetailGateway {
	constructor(private readonly client: SupabaseClient<Database>) {}

	async loadDocument(documentId: string) {
		const { data, error } = await this.client
			.from('documents')
			.select(
				'id,title,kind,status,page_count,notebook_id,original_filename,storage_path,drive_file_id,physical_state,created_at,updated_at'
			)
			.eq('id', validId(documentId, 'document'))
			.maybeSingle();
		if (error) throw new DocumentDetailError('unavailable');
		return data as unknown as DocumentDetailRecord | null;
	}

	async listPageSummaries(documentId: string) {
		const { data, error } = await this.client
			.from('pages')
			.select('id,page_number,source_drive_file_id,status,updated_at')
			.eq('document_id', validId(documentId, 'document'))
			.order('page_number', { ascending: true });
		if (error || !Array.isArray(data)) throw new DocumentDetailError('unavailable');
		return data as unknown as DocumentPageSummaryRecord[];
	}

	async loadPage(documentId: string, pageNumber: number) {
		const { data, error } = await this.client
			.from('pages')
			.select(
				'id,page_number,native_text,ocr_raw_text,corrected_text,extraction_source,source_drive_file_id,ocr_word_geometry,warnings,status,was_manually_reviewed,updated_at'
			)
			.eq('document_id', validId(documentId, 'document'))
			.eq('page_number', validPageNumber(pageNumber))
			.maybeSingle();
		if (error) throw new DocumentDetailError('unavailable');
		return data as unknown as PageRecord | null;
	}

	async createSignedUrl(storagePath: string) {
		const { data, error } = await this.client.storage
			.from('documents')
			.createSignedUrl(storagePath, 600);
		if (error || !data?.signedUrl) throw new DocumentDetailError('unavailable');
		return data.signedUrl;
	}
}

export function invalidateDocumentDetail(documentId: string) {
	if (!UUID.test(documentId)) return;
	for (const key of detailCache.keys()) {
		if (key.endsWith(`:${documentId}`)) detailCache.delete(key);
	}
	for (const key of detailInflight.keys()) {
		if (key.endsWith(`:${documentId}`)) detailInflight.delete(key);
	}
	for (const key of previewCache.keys()) {
		if (key.includes(`:${documentId}:`)) previewCache.delete(key);
	}
	for (const key of previewInflight.keys()) {
		if (key.includes(`:${documentId}:`)) previewInflight.delete(key);
	}
	for (const key of pageCache.keys()) {
		if (key.includes(`:${documentId}:`)) pageCache.delete(key);
	}
	for (const key of pageInflight.keys()) {
		if (key.includes(`:${documentId}:`)) pageInflight.delete(key);
	}
}

export async function loadDocumentDetail(
	documentId: string | undefined,
	client?: SupabaseClient<Database>
): Promise<DocumentDetail> {
	if (!documentId) throw new TypeError('Invalid document identifier');
	const validatedDocumentId = validId(documentId, 'document');
	const resolvedClient = client ?? getSupabaseClient();
	const gateway = new SupabaseDocumentGateway(resolvedClient);
	if (client) return loadDocumentDetailWithGateway(validatedDocumentId, gateway);
	const preferNative =
		isNativeRuntime() && typeof navigator !== 'undefined' && navigator.onLine === false;
	if (preferNative) {
		const nativeDetail = await loadNativeDocumentDetail(validatedDocumentId);
		if (nativeDetail) return nativeDetail;
	}

	const userId = await currentCacheUserId(resolvedClient);
	if (!userId) {
		try {
			return await loadDocumentDetailWithGateway(validatedDocumentId, gateway);
		} catch (error) {
			const nativeDetail = await loadNativeDocumentDetail(validatedDocumentId);
			if (nativeDetail) return nativeDetail;
			throw error;
		}
	}
	const key = detailCacheKey(userId, validatedDocumentId);
	const cached = getCached(detailCache, key);
	if (cached) return cached;
	const existing = detailInflight.get(key);
	if (existing) return existing;
	const request = loadDocumentDetailWithGateway(validatedDocumentId, gateway)
		.catch(async (error) => {
			const nativeDetail = await loadNativeDocumentDetail(validatedDocumentId);
			if (nativeDetail) return nativeDetail;
			throw error;
		})
		.then((detail) => {
			putCached(detailCache, key, detail, DETAIL_CACHE_TTL_MS, DETAIL_CACHE_MAX_ENTRIES);
			return detail;
		})
		.finally(() => detailInflight.delete(key));
	detailInflight.set(key, request);
	return request;
}

export async function loadDocumentPreview(
	documentId: string | undefined,
	pageNumber: number,
	client?: SupabaseClient<Database>
): Promise<DocumentPreview> {
	if (!documentId) throw new TypeError('Invalid document identifier');
	const validatedDocumentId = validId(documentId, 'document');
	const validatedPageNumber = validPageNumber(pageNumber);
	const resolvedClient = client ?? getSupabaseClient();
	const gateway = new SupabaseDocumentGateway(resolvedClient);
	if (client) {
		return loadDocumentPreviewWithGateway(validatedDocumentId, validatedPageNumber, gateway);
	}
	const preferNative =
		isNativeRuntime() && typeof navigator !== 'undefined' && navigator.onLine === false;
	if (preferNative) {
		const nativePreview = await loadNativeDocumentPreview(validatedDocumentId, validatedPageNumber);
		if (nativePreview) return nativePreview;
	}

	const userId = await currentCacheUserId(resolvedClient);
	if (!userId) {
		try {
			return await loadDocumentPreviewWithGateway(
				validatedDocumentId,
				validatedPageNumber,
				gateway
			);
		} catch (error) {
			const nativePreview = await loadNativeDocumentPreview(
				validatedDocumentId,
				validatedPageNumber
			);
			if (nativePreview) return nativePreview;
			throw error;
		}
	}
	const key = `${userId}:${validatedDocumentId}:${validatedPageNumber}`;
	const cached = getCached(previewCache, key);
	if (cached) return cached;
	const existing = previewInflight.get(key);
	if (existing) return existing;
	const request = loadDocumentPreviewWithGateway(validatedDocumentId, validatedPageNumber, gateway)
		.catch(async (error) => {
			const nativePreview = await loadNativeDocumentPreview(
				validatedDocumentId,
				validatedPageNumber
			);
			if (nativePreview) return nativePreview;
			throw error;
		})
		.then((preview) => {
			putCached(previewCache, key, preview, DETAIL_CACHE_TTL_MS, DETAIL_CACHE_MAX_ENTRIES);
			return preview;
		})
		.finally(() => previewInflight.delete(key));
	previewInflight.set(key, request);
	return request;
}

export async function loadDocumentPage(
	documentId: string | undefined,
	pageNumber: number,
	client?: SupabaseClient<Database>
): Promise<PageDetail> {
	if (!documentId) throw new TypeError('Invalid document identifier');
	const validatedDocumentId = validId(documentId, 'document');
	const validatedPageNumber = validPageNumber(pageNumber);
	const resolvedClient = client ?? getSupabaseClient();
	const gateway = new SupabaseDocumentGateway(resolvedClient);
	if (client) return loadDocumentPageWithGateway(validatedDocumentId, validatedPageNumber, gateway);
	const preferNative =
		isNativeRuntime() && typeof navigator !== 'undefined' && navigator.onLine === false;
	if (preferNative) {
		const nativePage = await loadNativeDocumentPage(validatedDocumentId, validatedPageNumber);
		if (nativePage) return nativePage;
	}

	const userId = await currentCacheUserId(resolvedClient);
	if (!userId) {
		try {
			return await loadDocumentPageWithGateway(validatedDocumentId, validatedPageNumber, gateway);
		} catch (error) {
			const nativePage = await loadNativeDocumentPage(validatedDocumentId, validatedPageNumber);
			if (nativePage) return nativePage;
			throw error;
		}
	}
	const key = pageCacheKey(userId, validatedDocumentId, validatedPageNumber);
	const cached = getCached(pageCache, key);
	if (cached) return cached;
	const existing = pageInflight.get(key);
	if (existing) return existing;
	const request = loadDocumentPageWithGateway(validatedDocumentId, validatedPageNumber, gateway)
		.catch(async (error) => {
			const nativePage = await loadNativeDocumentPage(validatedDocumentId, validatedPageNumber);
			if (nativePage) return nativePage;
			throw error;
		})
		.then((page) => {
			putCached(pageCache, key, page, PAGE_CACHE_TTL_MS, PAGE_CACHE_MAX_ENTRIES);
			return page;
		})
		.finally(() => pageInflight.delete(key));
	pageInflight.set(key, request);
	return request;
}

export async function prefetchDocumentPages(documentId: string, pageNumbers: readonly number[]) {
	const unique = [...new Set(pageNumbers.filter((pageNumber) => Number.isInteger(pageNumber)))];
	await Promise.allSettled(unique.map((pageNumber) => loadDocumentPage(documentId, pageNumber)));
}
