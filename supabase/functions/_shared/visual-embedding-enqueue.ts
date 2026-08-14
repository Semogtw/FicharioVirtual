import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { OcrContentClass, OcrWordGeometry } from './ocr-batch-contract.ts';
import { SEMANTIC_EMBEDDING_MODEL } from './semantic-config.ts';
import {
	decideVisualEmbedding,
	visualEmbeddingMimeTypeFromPath,
	type VisualEmbeddingDecision
} from './visual-embedding-routing.ts';

type SupportedVisualMime = 'image/jpeg' | 'image/png';

export type VisualEmbeddingEnqueueResult = Readonly<{
	decision: VisualEmbeddingDecision;
	queued: boolean;
	preserveTemporaryMedia: boolean;
	mimeType: SupportedVisualMime | null;
}>;

function supportedMimeType(value: string | null | undefined): SupportedVisualMime | null {
	if (!value) return null;
	const normalized = value.split(';', 1)[0]!.trim().toLowerCase();
	if (normalized === 'image/jpeg' || normalized === 'image/png') return normalized;
	return null;
}

function queuedFromRpc(value: unknown) {
	return Boolean(
		value &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			(value as Record<string, unknown>).queued === true
	);
}

export async function enqueueVisualEmbeddingAfterOcr(input: {
	supabase: SupabaseClient;
	pageId: string;
	mediaPath: string | null;
	mediaMimeType?: string | null;
	contentClass: OcrContentClass;
	warnings: readonly unknown[];
	needsReview: boolean;
	effectiveText: string;
	wordGeometry: OcrWordGeometry;
}): Promise<VisualEmbeddingEnqueueResult> {
	const decision = decideVisualEmbedding({
		hasNativeText: false,
		contentClass: input.contentClass,
		warningCount: input.warnings.length,
		needsReview: input.needsReview,
		effectiveTextLength: input.effectiveText.trim().length,
		wordBoxCount: input.wordGeometry.length
	});
	const mimeType =
		supportedMimeType(input.mediaMimeType) ?? visualEmbeddingMimeTypeFromPath(input.mediaPath);
	if (!decision.eligible || !input.mediaPath || !mimeType) {
		return Object.freeze({ decision, queued: false, preserveTemporaryMedia: false, mimeType });
	}

	try {
		const { data, error } = await input.supabase.rpc('queue_page_visual_embedding_job', {
			target_page_id: input.pageId,
			target_model: SEMANTIC_EMBEDDING_MODEL,
			target_media_path: input.mediaPath,
			target_mime_type: mimeType,
			target_routing_reason: decision.reason,
			target_routing_version: decision.routingVersion
		});
		const queued = !error && queuedFromRpc(data);
		return Object.freeze({
			decision,
			queued,
			preserveTemporaryMedia: queued,
			mimeType
		});
	} catch {
		// Visual enrichment is optional. OCR completion remains authoritative.
		return Object.freeze({ decision, queued: false, preserveTemporaryMedia: false, mimeType });
	}
}

export async function visualTemporaryMediaIsNeeded(input: {
	supabase: SupabaseClient;
	pageId: string;
	mediaPath: string | null;
}) {
	if (!input.mediaPath) return false;
	try {
		const { data, error } = await input.supabase.rpc('page_visual_temporary_media_needed', {
			target_page_id: input.pageId,
			expected_media_path: input.mediaPath
		});
		return !error && data === true;
	} catch {
		// If the guard lookup is unavailable, preserve the temporary source. A
		// later worker/maintenance pass can remove it safely; deleting it here
		// could make an already-queued visual job unrecoverable.
		return true;
	}
}
