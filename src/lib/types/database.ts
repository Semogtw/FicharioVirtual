// Provisional schema mirror. Replace with `supabase gen types typescript --local`
// after the local Supabase gate is available and keep the exported shape stable.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type DocumentKind = 'image' | 'pdf';
export type DocumentStatus =
	'uploading' | 'pending' | 'processing' | 'ready' | 'partially_ready' | 'needs_review' | 'failed';
export type ProcessingStatus =
	'pending' | 'processing' | 'ready' | 'retryable' | 'blocked_quota' | 'needs_review' | 'failed';
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
export type OcrRoute = 'gemini' | 'desktop';

type TableDefinition<Row, Insert, Update> = {
	Row: Row;
	Insert: Insert;
	Update: Update;
	Relationships: [];
};

type AppUserRow = {
	user_id: string;
	is_active: boolean;
	ocr_consent_at: string | null;
	ocr_consent_version: number | null;
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

type OcrBatchRow = {
	id: string;
	user_id: string;
	document_id: string;
	route: OcrRoute;
	status: ProcessingStatus;
	page_ids: string[];
	page_numbers: number[];
	source_bytes: number;
	derived_bytes: number;
	split_depth: number;
	parent_batch_id: string | null;
	model: string | null;
	prompt_version: number;
	attempt_count: number;
	provider_call_count: number;
	last_error_code: string | null;
	last_error_message: string | null;
	next_retry_at: string | null;
	started_at: string | null;
	finished_at: string | null;
	created_at: string;
	updated_at: string;
};

type OcrJobRow = {
	id: string;
	user_id: string;
	page_id: string;
	batch_id: string | null;
	batch_ordinal: number | null;
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
	updated_at: string;
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
	ocr_batches: number;
	ocr_calls: number;
	ocr_attempts: number;
	quality_reprocess_pages: number;
	quota_errors: number;
	failed_pages: number;
	uploaded_bytes: number;
	storage_bytes_estimated: number;
	updated_at: string;
};

type DrivePdfReferenceImportStatus =
	| 'pending_inspection'
	| 'inspecting'
	| 'ready_to_finalize'
	| 'failed';

type DrivePdfReferenceImportRow = {
	document_id: string;
	user_id: string;
	source_size_bytes: number;
	source_modified_at: string;
	status: DrivePdfReferenceImportStatus;
	last_error_code: string | null;
	created_at: string;
	updated_at: string;
};

export type Database = {
	public: {
		Tables: {
			app_users: TableDefinition<
				AppUserRow,
				{
					user_id: string;
					is_active?: boolean;
					ocr_consent_at?: string | null;
					ocr_consent_version?: number | null;
					created_at?: string;
					updated_at?: string;
				},
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
			ocr_batches: TableDefinition<
				OcrBatchRow,
				{
					id?: string;
					user_id: string;
					document_id: string;
					route?: OcrRoute;
					status?: ProcessingStatus;
					page_ids: string[];
					page_numbers: number[];
					source_bytes?: number;
					derived_bytes?: number;
					split_depth?: number;
					parent_batch_id?: string | null;
					model?: string | null;
					prompt_version?: number;
					attempt_count?: number;
					provider_call_count?: number;
					last_error_code?: string | null;
					last_error_message?: string | null;
					next_retry_at?: string | null;
					started_at?: string | null;
					finished_at?: string | null;
					created_at?: string;
					updated_at?: string;
				},
				Partial<Omit<OcrBatchRow, 'id' | 'user_id' | 'document_id' | 'page_ids' | 'page_numbers'>>
			>;
			ocr_jobs: TableDefinition<
				OcrJobRow,
				{
					id?: string;
					user_id: string;
					page_id: string;
					batch_id?: string | null;
					batch_ordinal?: number | null;
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
				{
					id?: string;
					user_id: string;
					name: string;
					normalized_name?: string;
					created_at?: string;
					updated_at?: string;
				},
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
					ocr_batches?: number;
					ocr_calls?: number;
					ocr_attempts?: number;
					quality_reprocess_pages?: number;
					quota_errors?: number;
					failed_pages?: number;
					uploaded_bytes?: number;
					storage_bytes_estimated?: number;
					updated_at?: string;
				},
				Partial<Omit<UsageDailyRow, 'user_id' | 'usage_date'>>
			>;
			drive_pdf_reference_imports: TableDefinition<
				DrivePdfReferenceImportRow,
				{
					document_id: string;
					user_id: string;
					source_size_bytes: number;
					source_modified_at: string;
					status?: DrivePdfReferenceImportStatus;
					last_error_code?: string | null;
					created_at?: string;
					updated_at?: string;
				},
				Partial<Omit<DrivePdfReferenceImportRow, 'document_id' | 'user_id'>>
			>;
		};
		Views: Record<string, never>;
		Functions: {
			claim_ocr_job: {
				Args: { target_page_id: string; target_model: string; claimed_at: string };
				Returns: Json;
			};
			complete_drive_legacy_migration: {
				Args: {
					target_document_id: string;
					expected_storage_path: string;
					target_drive_file_id: string;
					target_drive_parent_folder_id: string;
					target_drive_mime_type: string;
					target_drive_modified_time: string;
					target_drive_version: string;
					target_drive_md5_checksum: string | null;
				};
				Returns: boolean;
			};
			complete_ocr_job: {
				Args: {
					target_page_id: string;
					extracted_text: string;
					extraction_warnings: Json;
					terminal_status: 'ready' | 'needs_review';
					completed_at: string;
				};
				Returns: boolean;
			};
			create_drive_image_import: {
				Args: {
					target_document_id: string;
					target_page_id: string;
					target_job_id: string;
					target_notebook_id: string | null;
					document_title: string;
					original_filename: string;
					target_drive_file_id: string;
					target_drive_parent_folder_id: string;
					target_drive_mime_type: string;
					target_drive_modified_time: string;
					target_drive_version: string;
					target_drive_md5_checksum: string | null;
					thumbnail_storage_path: string;
					prepared_sha256: string;
					source_created_at?: string | null;
					prompt_version?: number;
				};
				Returns: Array<{ document_id: string; page_id: string; ocr_job_id: string }>;
			};
			create_drive_pdf_import: {
				Args: {
					target_document_id: string;
					target_notebook_id: string | null;
					document_title: string;
					original_filename: string;
					target_drive_file_id: string;
					target_drive_parent_folder_id: string;
					target_drive_mime_type: string;
					target_drive_modified_time: string;
					target_drive_version: string;
					target_drive_md5_checksum: string | null;
					prepared_sha256: string;
					source_created_at: string | null;
					page_descriptors: Json;
					prompt_version?: number;
				};
				Returns: Json;
			};
			create_image_import: {
				Args: {
					target_document_id: string;
					target_page_id: string;
					target_job_id: string;
					target_notebook_id: string | null;
					document_title: string;
					original_filename: string;
					original_storage_path: string;
					thumbnail_storage_path: string;
					prepared_sha256: string;
					source_created_at?: string | null;
					prompt_version?: number;
				};
				Returns: Array<{ document_id: string; page_id: string; ocr_job_id: string }>;
			};
			create_pdf_import: {
				Args: {
					target_document_id: string;
					target_notebook_id: string | null;
					document_title: string;
					original_filename: string;
					original_storage_path: string;
					prepared_sha256: string;
					source_created_at: string | null;
					page_descriptors: Json;
					prompt_version?: number;
				};
				Returns: Json;
			};
			create_tag: { Args: { tag_name: string }; Returns: string };
			delete_notebook: { Args: { target_notebook_id: string }; Returns: boolean };
			delete_tag: { Args: { target_tag_id: string }; Returns: boolean };
			export_portable_manifest: { Args: Record<string, never>; Returns: Json };
			finish_ocr_batch: {
				Args: {
					target_batch_id: string;
					terminal_status: 'ready' | 'retryable' | 'blocked_quota' | 'failed';
					error_code: string | null;
					safe_error_message: string | null;
					retry_at: string | null;
					finished_at: string;
				};
				Returns: boolean;
			};
			get_usage_overview: { Args: Record<string, never>; Returns: Json };
			is_authorized_user: { Args: Record<string, never>; Returns: boolean };
			list_notebooks: {
				Args: Record<string, never>;
				Returns: Array<{
					id: string;
					name: string;
					description: string | null;
					cover_style: string;
					created_at: string;
					updated_at: string;
					document_count: number;
				}>;
			};
			list_runnable_ocr_jobs: {
				Args: { selection_at?: string; result_limit?: number };
				Returns: Array<{ page_id: string; attempt_count: number }>;
			};
			list_resumable_ocr_pages: {
				Args: { target_document_id: string; selection_at?: string };
				Returns: Array<{ page_id: string; page_number: number }>;
			};
			list_review_pages: {
				Args: { result_limit?: number; result_offset?: number };
				Returns: Array<{
					page_id: string;
					document_id: string;
					document_title: string;
					document_kind: DocumentKind;
					page_number: number;
					page_status: ProcessingStatus;
					excerpt: string;
					warnings: Json;
					updated_at: string;
				}>;
			};
			list_tag_document_ids: {
				Args: { target_tag_id: string };
				Returns: Array<{ document_id: string }>;
			};
			list_tags: {
				Args: Record<string, never>;
				Returns: Array<{
					tag_id: string;
					name: string;
					document_count: number;
					created_at: string;
					updated_at: string;
				}>;
			};
			reconnect_missing_drive_document: {
				Args: {
					target_document_id: string;
					target_drive_file_id: string;
					target_drive_parent_folder_id: string;
					target_drive_mime_type: string;
					target_drive_modified_time: string;
					target_drive_version: string;
					target_drive_md5_checksum: string | null;
				};
				Returns: boolean;
			};
			record_ocr_batch_call: {
				Args: { target_batch_id: string; attempted_pages: number; called_at: string };
				Returns: boolean;
			};
			record_ocr_consent: { Args: { consent_version?: number }; Returns: boolean };
			recover_stale_ocr_jobs: { Args: Record<string, never>; Returns: number };
			register_ocr_batch: {
				Args: {
					target_document_id: string;
					target_route: OcrRoute;
					target_page_ids: string[];
					target_page_numbers: number[];
					target_source_bytes: number;
					target_derived_bytes: number;
					target_split_depth: number;
					target_parent_batch_id: string | null;
					target_model: string | null;
					target_prompt_version: number;
					registered_at: string;
				};
				Returns: string | null;
			};
			rename_tag: {
				Args: { target_tag_id: string; tag_name: string };
				Returns: boolean;
			};
			resolve_drive_conflict: {
				Args: { target_conflict_id: string; target_resolution: 'retry_local' | 'mark_missing' };
				Returns: boolean;
			};
			resolve_page_locations: {
				Args: { target_page_ids: string[] };
				Returns: Array<{
					page_id: string;
					document_id: string;
					document_title: string;
					page_number: number;
					page_updated_at: string;
				}>;
			};
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
			stage_drive_pdf_reference: {
				Args: {
					target_document_id: string;
					target_notebook_id: string | null;
					document_title: string;
					original_filename: string;
					target_drive_file_id: string;
					target_drive_parent_folder_id: string;
					target_drive_modified_time: string;
					target_drive_version: string;
					target_drive_md5_checksum: string | null;
					source_size_bytes: number;
					source_modified_at: string;
				};
				Returns: Json;
			};
			set_tag_membership: {
				Args: { target_tag_id: string; target_document_id: string; assigned: boolean };
				Returns: boolean;
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
