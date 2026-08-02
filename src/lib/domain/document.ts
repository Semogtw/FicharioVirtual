export type DocumentKind = 'image' | 'pdf';
export type DocumentStatus =
	| 'uploading'
	| 'pending'
	| 'processing'
	| 'ready'
	| 'partially_ready'
	| 'needs_review'
	| 'failed';

export interface DocumentSummary {
	id: string;
	title: string;
	kind: DocumentKind;
	status: DocumentStatus;
	pageCount: number;
	thumbnailPath: string | null;
	notebookId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface DocumentRecord {
	id: string;
	title: string;
	kind: DocumentKind;
	status: DocumentStatus;
	page_count: number;
	thumbnail_path: string | null;
	notebook_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface DocumentFilters {
	notebookId?: string | null;
	kind?: DocumentKind | null;
	status?: DocumentStatus | null;
	createdFrom?: string | null;
	createdTo?: string | null;
}

export interface DocumentCursor {
	createdAt: string;
	id: string;
}

export interface DocumentPage {
	items: readonly DocumentSummary[];
	nextCursor: DocumentCursor | null;
}

export interface NewDocumentInput {
	notebookId?: string | null;
	title: string;
	kind: DocumentKind;
	originalFilename: string;
	storagePath: string;
	thumbnailPath?: string | null;
	sha256?: string | null;
	sourceCreatedAt?: string | null;
}

export interface UpdateDocumentInput {
	title?: string;
	notebookId?: string | null;
	status?: DocumentStatus;
	thumbnailPath?: string | null;
	pageCount?: number;
}

export function mapDocumentRecord(record: DocumentRecord): DocumentSummary {
	return Object.freeze({
		id: record.id,
		title: record.title,
		kind: record.kind,
		status: record.status,
		pageCount: record.page_count,
		thumbnailPath: record.thumbnail_path,
		notebookId: record.notebook_id,
		createdAt: record.created_at,
		updatedAt: record.updated_at
	});
}
