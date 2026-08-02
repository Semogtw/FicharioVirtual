// Provisional schema mirror. Replace with `supabase gen types typescript --local`
// after the local Supabase gate is available and keep the exported shape stable.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type DocumentKind = 'image' | 'pdf';
export type DocumentStatus =
	| 'uploading'
	| 'pending'
	| 'processing'
	| 'ready'
	| 'partially_ready'
	| 'needs_review'
	| 'failed';
export type ProcessingStatus =
	| 'pending'
	| 'processing'
	| 'ready'
	| 'retryable'
	| 'blocked_quota'
	| 'needs_review'
	| 'failed';
export type ExtractionSource = 'native_pdf' | 'ocr' | 'manual';
export type ImportStatus =
	| 'draft'
	| 'preparing'
	| 'uploading'
	| 'processing'
	| 'completed'
	| 'paused'
	| 'failed'
	| 'cancelled';

type TableDefinition<Row, Insert, Update> = {
	Row: Row;
	Insert: Insert;
	Update: Update;
	Relationships: [];
};

type AppUserRow = {
	user_id: string;
	is_active: boolean;
	created_at: string;
	updated_at: string;
};

type NotebookRow = {
	id: string;
	user_id: string;
	name: string;
	description: string | null;
	cover_style: string;
	created_at: string;
	updated_at: string;
};

type DocumentRow = {
	id: string;
	user_id: string;
	notebook_id: string | null;
	title: string;
	kind: DocumentKind;
	original_filename: string;
	storage_path: string;
	thumbnail_path: string | null;
	page_count: number;
	status: DocumentStatus;
	sha256: string | null;
	source_created_at: string | null;
	created_at: string;
	updated_at: string;
};

type PageRow = {
	id: string;
	user_id: string;
	document_id: string;
	page_number: number;
	native_text: string | null;
	ocr_raw_text: string | null;
	corrected_text: string | null;
	normalized_text: string;
	search_vector: unknown;
	extraction_source: ExtractionSource | null;
	temporary_image_path: string | null;
	warnings: Json;
	status: ProcessingStatus;
	was_manually_reviewed: boolean;
	created_at: string;
	updated_at: string;
};

type OcrJobRow = {
	id: string;
	user_id: string;
	page_id: string;
	provider: string;
	model: string | null;
	prompt_version: number;
	status: ProcessingStatus;
	attempt_count: number;
	idempotency_key: string;
	last_error_code: string | null;
	last_error_message: string | null;
	next_retry_at: string | null;
	started_at: string | null;
	finished_at: string | null;
	created_at: string;
	updated_at: string;
};

type TagRow = {
	id: string;
	user_id: string;
	name: string;
	normalized_name: string;
	created_at: string;
};

type DocumentTagRow = {
	user_id: string;
	document_id: string;
	tag_id: string;
	created_at: string;
};

type ImportSessionRow = {
	id: string;
	user_id: string;
	status: ImportStatus;
	total_items: number;
	prepared_items: number;
	uploaded_items: number;
	completed_items: number;
	last_error_code: string | null;
	local_resume_key: string | null;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
};

type UsageDailyRow = {
	user_id: string;
	usage_date: string;
	ocr_pages: number;
	quality_reprocess_pages: number;
	quota_errors: number;
	failed_pages: number;
	uploaded_bytes: number;
	storage_bytes_estimated: number;
	updated_at: string;
};

export type Database = {
	public: {
		Tables: {
			app_users: TableDefinition<
				AppUserRow,
				{ user_id: string; is_active?: boolean; created_at?: string; updated_at?: string },
				Partial<Omit<AppUserRow, 'user_id'>>
			>;
			notebooks: TableDefinition<
				NotebookRow,
				{
					id?: string;
					user_id: string;
					name: string;
					description?: string | null;
					cover_style?: string;
					created_at?: string;
					updated_at?: string;
				},
				Partial<Omit<NotebookRow, 'id' | 'user_id'>>
			>;
			documents: TableDefinition<
				DocumentRow,
				{
					id?: string;
					user_id: string;
					notebook_id?: string | null;
					title: string;
					kind: DocumentKind;
					original_filename: string;
					storage_path: string;
					thumbnail_path?: string | null;
					page_count?: number;
					status?: DocumentStatus;
					sha256?: string | null;
					source_created_at?: string | null;
					created_at?: string;
					updated_at?: string;
				},
				Partial<Omit<DocumentRow, 'id' | 'user_id'>>
			>;
			pages: TableDefinition<
				PageRow,
				{
					id?: string;
					user_id: string;
					document_id: string;
					page_number: number;
					native_text?: string | null;
					ocr_raw_text?: string | null;
					corrected_text?: string | null;
					extraction_source?: ExtractionSource | null;
					temporary_image_path?: string | null;
					warnings?: Json;
					status?: ProcessingStatus;
					was_manually_reviewed?: boolean;
					created_at?: string;
					updated_at?: string;
				},
				Partial<Omit<PageRow, 'id' | 'user_id' | 'document_id' | 'search_vector'>>
			>;
			ocr_jobs: TableDefinition<
				OcrJobRow,
				{
					id?: string;
					user_id: string;
					page_id: string;
					provider?: string;
					model?: string | null;
					prompt_version?: number;
					status?: ProcessingStatus;
					attempt_count?: number;
					idempotency_key: string;
					last_error_code?: string | null;
					last_error_message?: string | null;
					next_retry_at?: string | null;
					started_at?: string | null;
					finished_at?: string | null;
					created_at?: string;
					updated_at?: string;
				},
				Partial<Omit<OcrJobRow, 'id' | 'user_id' | 'page_id' | 'idempotency_key'>>
			>;
			tags: TableDefinition<
				TagRow,
				{ id?: string; user_id: string; name: string; normalized_name?: string; created_at?: string },
				Partial<Omit<TagRow, 'id' | 'user_id'>>
			>;
			document_tags: TableDefinition<
				DocumentTagRow,
				{ user_id: string; document_id: string; tag_id: string; created_at?: string },
				Partial<Omit<DocumentTagRow, 'user_id' | 'document_id' | 'tag_id'>>
			>;
			import_sessions: TableDefinition<
				ImportSessionRow,
				{
					id?: string;
					user_id: string;
					status?: ImportStatus;
					total_items?: number;
					prepared_items?: number;
					uploaded_items?: number;
					completed_items?: number;
					last_error_code?: string | null;
					local_resume_key?: string | null;
					created_at?: string;
					updated_at?: string;
					finished_at?: string | null;
				},
				Partial<Omit<ImportSessionRow, 'id' | 'user_id'>>
			>;
			usage_daily: TableDefinition<
				UsageDailyRow,
				{
					user_id: string;
					usage_date?: string;
					ocr_pages?: number;
					quality_reprocess_pages?: number;
					quota_errors?: number;
					failed_pages?: number;
					uploaded_bytes?: number;
					storage_bytes_estimated?: number;
					updated_at?: string;
				},
				Partial<Omit<UsageDailyRow, 'user_id' | 'usage_date'>>
			>;
		};
		Views: Record<string, never>;
		Functions: {
			is_authorized_user: { Args: Record<string, never>; Returns: boolean };
			search_pages: {
				Args: {
					search_query: string;
					notebook_filter?: string | null;
					result_limit?: number;
					result_offset?: number;
				};
				Returns: Array<{
					page_id: string;
					document_id: string;
					document_title: string;
					notebook_id: string | null;
					notebook_name: string | null;
					page_number: number;
					excerpt: string;
					rank: number;
				}>;
			};
		};
		Enums: {
			document_kind: DocumentKind;
			document_status: DocumentStatus;
			processing_status: ProcessingStatus;
			extraction_source: ExtractionSource;
			import_status: ImportStatus;
		};
		CompositeTypes: Record<string, never>;
	};
};
