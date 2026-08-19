import type { Json } from './database';

/**
 * RPC contracts added after the provisional schema mirror in `database.ts`.
 *
 * Keep this file small and migration-backed. It exists so newly introduced RPCs
 * remain explicitly typed until the canonical database mirror is regenerated
 * from the linked Supabase project, as described in docs/DEPLOYMENT.md.
 */
export type DatabaseRpcExtensions = {
	public: {
		Functions: {
			ensure_current_app_user: {
				Args: Record<string, never>;
				Returns: 'owner' | 'public' | null;
			};
			current_provider_profile: {
				Args: Record<string, never>;
				Returns: 'owner' | 'public' | null;
			};
			list_notebooks_v2: {
				Args: Record<string, never>;
				Returns: Array<{
					id: string;
					name: string;
					description: string | null;
					cover_style: string;
					parent_notebook_id: string | null;
					banner_path: string | null;
					banner_position_x: number;
					banner_position_y: number;
					created_at: string;
					updated_at: string;
					document_count: number;
				}>;
			};
			create_drive_image_import_v2: {
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
					ocr_storage_path: string;
					thumbnail_storage_path: string;
					prepared_sha256: string;
					source_sha256: string;
					preprocessing_profile: string;
					preprocessing_version: number;
					preprocessing_auto_crop: boolean;
					preprocessing_retained_permille: number;
					preprocessing_deskew_mdeg: number;
					preprocessing_illumination: boolean;
					preprocessing_contrast: boolean;
					preprocessing_fallback: boolean;
					preprocessing_source_width: number;
					preprocessing_source_height: number;
					preprocessing_prepared_width: number;
					preprocessing_prepared_height: number;
					preprocessing_original_bytes: number;
					preprocessing_prepared_bytes: number;
					source_created_at?: string | null;
					prompt_version?: number;
				};
				Returns: Array<{ document_id: string; page_id: string; ocr_job_id: string }>;
			};
			append_drive_image_page_v1: {
				Args: {
					target_document_id: string;
					target_page_id: string;
					target_job_id: string;
					target_page_number: number;
					target_drive_file_id: string;
					target_drive_parent_folder_id: string;
					target_drive_mime_type: string;
					target_drive_modified_time: string;
					target_drive_version: string;
					target_drive_md5_checksum: string | null;
					ocr_storage_path: string;
					prepared_sha256: string;
					source_sha256: string;
					preprocessing_profile: string;
					preprocessing_version: number;
					preprocessing_auto_crop: boolean;
					preprocessing_retained_permille: number;
					preprocessing_deskew_mdeg: number;
					preprocessing_illumination: boolean;
					preprocessing_contrast: boolean;
					preprocessing_fallback: boolean;
					preprocessing_source_width: number;
					preprocessing_source_height: number;
					preprocessing_prepared_width: number;
					preprocessing_prepared_height: number;
					preprocessing_original_bytes: number;
					preprocessing_prepared_bytes: number;
					prompt_version?: number;
				};
				Returns: Array<{ document_id: string; page_id: string; ocr_job_id: string }>;
			};
			get_document_ocr_summary: {
				Args: { target_document_id: string };
				Returns: Array<{
					total: number;
					completed: number;
					needs_review: number;
					pending: number;
					failed: number;
				}>;
			};
			list_gemini_ocr_candidates: {
				Args: Record<string, never>;
				Returns: Array<{
					job_id: string;
					page_id: string;
					document_id: string;
					document_title: string;
					page_number: number;
					attempt_count: number;
					created_at: string;
					updated_at: string;
				}>;
			};
			search_documents: {
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
		Enums: Record<string, never>;
	};
};

// This composition is available to call sites that need the newest RPCs before
// the next full `supabase gen types` refresh.
export type DatabaseWithRpcExtensions<TDatabase> = TDatabase & DatabaseRpcExtensions;

// Keep Json referenced so accidental removal of the canonical type import is
// caught when this bridge is consolidated into generated types.
export type RpcJson = Json;
