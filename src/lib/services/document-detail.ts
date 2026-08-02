import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPageRecord, type PageDetail, type PageRecord } from '$lib/domain/page';
import type { Database, DocumentKind, DocumentStatus, ProcessingStatus } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CORRECTION_LENGTH = 1_000_000;

export type DocumentDetailRecord = {
	id: string;
	title: string;
	kind: DocumentKind;
	status: DocumentStatus;
	page_count: number;
	notebook_id: string | null;
	original_filename: string;
	storage_path: string;
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
	originalUrl: string;
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

export async function loadDocumentDetailWithGateway(
	documentId: string,
	gateway: DocumentDetailGateway
): Promise<DocumentDetail> {
	validId(documentId, 'document');
	const document = await gateway.loadDocument(documentId);
	if (document === null) throw new DocumentDetailError('not_found');
	const [pages, originalUrl] = await Promise.all([
		gateway.listPages(documentId),
		gateway.createSignedUrl(document.storage_path)
	]);
	return Object.freeze({
		id: document.id,
		title: document.title,
		kind: document.kind,
		status: document.status,
		pageCount: document.page_count,
		notebookId: document.notebook_id,
		originalFilename: document.original_filename,
		originalUrl,
		pages: Object.freeze([...pages].map(mapPageRecord).sort((left, right) => left.pageNumber - right.pageNumber)),
		createdAt: document.created_at,
		updatedAt: document.updated_at
	});
}

export async function savePageCorrectionWithGateway(
	pageId: string,
	text: string,
	gateway: DocumentDetailGateway
): Promise<PageDetail> {
	validId(pageId, 'page');
	if (typeof text !== 'string' || text.length > MAX_CORRECTION_LENGTH) {
		throw new DocumentDetailError('invalid_correction');
	}
	const correctedText = text.trim().length > 0 ? text : null;
	const status: ProcessingStatus = correctedText === null ? 'needs_review' : 'ready';
	const page = await gateway.saveCorrection(pageId, { correctedText, status });
	if (page === null) throw new DocumentDetailError('not_found');
	return mapPageRecord(page);
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
		const { data, error } = await this.client.storage.from('documents').createSignedUrl(storagePath, 600);
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
	documentId: string,
	client: SupabaseClient<Database> = getSupabaseClient()
) {
	return loadDocumentDetailWithGateway(documentId, new SupabaseDocumentGateway(client));
}

export function savePageCorrection(
	pageId: string,
	text: string,
	client: SupabaseClient<Database> = getSupabaseClient()
) {
	return savePageCorrectionWithGateway(pageId, text, new SupabaseDocumentGateway(client));
}
