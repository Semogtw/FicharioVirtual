import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { mapPageRecord, type PageDetail, type PageRecord } from '$lib/domain/page';
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
const MAX_CORRECTION_LENGTH = 1_000_000;
const timestamp = z.string().refine(isIsoTimestamp);
const warningSchema = z
	.object({
		code: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
		message: z
			.string()
			.max(300)
			.refine((value) => value.trim().length > 0)
	})
	.strict();
const pageRecordSchema = z
	.object({
		id: z.string().regex(UUID),
		page_number: z.number().int().min(1).max(10_000),
		native_text: z.string().max(MAX_CORRECTION_LENGTH).nullable(),
		ocr_raw_text: z.string().max(MAX_CORRECTION_LENGTH).nullable(),
		corrected_text: z.string().max(MAX_CORRECTION_LENGTH).nullable(),
		extraction_source: z.enum(['native_pdf', 'ocr', 'manual']).nullable(),
		warnings: z.array(warningSchema).max(100),
		status: z.enum([
			'pending',
			'processing',
			'ready',
			'retryable',
			'blocked_quota',
			'needs_review',
			'failed'
		]),
		was_manually_reviewed: z.boolean(),
		updated_at: timestamp
	})
	.strict();
const pageRecordsSchema = z.array(pageRecordSchema).max(10_000);
const driveFileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,256}$/);
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

export type DocumentDetail = {
	id: string;
	title: string;
	kind: DocumentKind;
	status: DocumentStatus;
	pageCount: number;
	notebookId: string | null;
	originalFilename: string;
	originalUrl: string | null;
	originalReference: Readonly<{
		provider: 'supabase' | 'google_drive' | 'missing';
		url: string | null;
		driveFileId: string | null;
	}>;
	physicalState: DrivePhysicalState;
	pages: readonly PageDetail[];
	createdAt: string;
	updatedAt: string;
};

export interface DocumentDetailGateway {
	loadDocument(documentId: string): Promise<DocumentDetailRecord | null>;
	listPages(documentId: string): Promise<readonly PageRecord[]>;
	createSignedUrl(storagePath: string): Promise<string>;
	saveCorrection(
		pageId: string,
		input: { correctedText: string | null; status: ProcessingStatus }
	): Promise<PageRecord | null>;
}

export class DocumentDetailError extends Error {
	readonly code: 'not_found' | 'unavailable' | 'invalid_correction';

	constructor(code: DocumentDetailError['code']) {
		const messages = {
			not_found: 'Este documento não existe ou não está disponível.',
			unavailable: 'Não foi possível abrir o documento agora.',
			invalid_correction: 'A correção excede o limite permitido.'
		} as const;
		super(messages[code]);
		this.name = 'DocumentDetailError';
		this.code = code;
	}
}

function validId(value: string, label: string) {
	if (!UUID.test(value)) throw new TypeError(`Invalid ${label} identifier`);
	return value;
}

function signedUrl(value: string) {
	const parsed = new URL(value);
	if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('Invalid signed URL');
	return value;
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
			gateway.listPages(validatedDocumentId),
			resolveOriginalReference(document, gateway)
		]);
		const pages = pageRecordsSchema.parse(rawPages);
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
				pages
					.map((page) => mapPageRecord(page))
					.sort((left, right) => left.pageNumber - right.pageNumber)
			),
			createdAt: document.created_at,
			updatedAt: document.updated_at
		});
	} catch (error) {
		preserveNotFound(error);
	}
}

export async function savePageCorrectionWithGateway(
	pageId: string,
	text: string,
	gateway: DocumentDetailGateway
): Promise<PageDetail> {
	const validatedPageId = validId(pageId, 'page');
	if (typeof text !== 'string' || text.length > MAX_CORRECTION_LENGTH) {
		throw new DocumentDetailError('invalid_correction');
	}
	const correctedText = text.trim().length > 0 ? text : null;
	const status: ProcessingStatus = correctedText === null ? 'needs_review' : 'ready';
	try {
		const rawPage = await gateway.saveCorrection(validatedPageId, { correctedText, status });
		if (rawPage === null) throw new DocumentDetailError('not_found');
		const page = pageRecordSchema.parse(rawPage);
		if (
			page.id !== validatedPageId ||
			page.corrected_text !== correctedText ||
			page.extraction_source !== 'manual' ||
			page.status !== status ||
			page.was_manually_reviewed !== true
		) {
			throw new DocumentDetailError('unavailable');
		}
		return mapPageRecord(page);
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
				'id,title,kind,status,page_count,notebook_id,original_filename,storage_path,created_at,updated_at'
			)
			.eq('id', validId(documentId, 'document'))
			.maybeSingle();
		if (error) throw new DocumentDetailError('unavailable');
		return data as unknown as DocumentDetailRecord | null;
	}

	async listPages(documentId: string) {
		const { data, error } = await this.client
			.from('pages')
			.select(
				'id,page_number,native_text,ocr_raw_text,corrected_text,extraction_source,warnings,status,was_manually_reviewed,updated_at'
			)
			.eq('document_id', validId(documentId, 'document'))
			.order('page_number', { ascending: true });
		if (error || !Array.isArray(data)) throw new DocumentDetailError('unavailable');
		return data as unknown as PageRecord[];
	}

	async createSignedUrl(storagePath: string) {
		const { data, error } = await this.client.storage
			.from('documents')
			.createSignedUrl(storagePath, 600);
		if (error || !data?.signedUrl) throw new DocumentDetailError('unavailable');
		return data.signedUrl;
	}

	async saveCorrection(
		pageId: string,
		input: { correctedText: string | null; status: ProcessingStatus }
	) {
		const { data, error } = await this.client
			.from('pages')
			.update({
				corrected_text: input.correctedText,
				extraction_source: 'manual',
				was_manually_reviewed: true,
				status: input.status
			})
			.eq('id', validId(pageId, 'page'))
			.select(
				'id,page_number,native_text,ocr_raw_text,corrected_text,extraction_source,warnings,status,was_manually_reviewed,updated_at'
			)
			.maybeSingle();
		if (error) throw new DocumentDetailError('unavailable');
		return data as unknown as PageRecord | null;
	}
}

export function loadDocumentDetail(
	documentId: string | undefined,
	client: SupabaseClient<Database> = getSupabaseClient()
) {
	if (!documentId) throw new TypeError('Invalid document identifier');
	return loadDocumentDetailWithGateway(documentId, new SupabaseDocumentGateway(client));
}

export function savePageCorrection(
	pageId: string,
	text: string,
	client: SupabaseClient<Database> = getSupabaseClient()
) {
	return savePageCorrectionWithGateway(pageId, text, new SupabaseDocumentGateway(client));
}
