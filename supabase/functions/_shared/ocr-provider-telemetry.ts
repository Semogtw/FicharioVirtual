import type { GeminiOcrBatchOutcome, GeminiOcrBatchPage } from './gemini-ocr-client.ts';

export type OcrContentClass =
	| 'unknown'
	| 'book_clean'
	| 'scan_degraded'
	| 'handwriting'
	| 'mixed'
	| 'table_layout'
	| 'math'
	| 'sparse';

export const OCR_CONTENT_CLASSIFICATION_VERSION = 1;

export function buildGeminiTelemetryRpcArgs(input: {
	eventId: string;
	documentId: string;
	batchId: string | null;
	model: string;
	promptVersion: number;
	documentKind: 'image' | 'pdf';
	pages: readonly GeminiOcrBatchPage[];
	outcome: GeminiOcrBatchOutcome | null;
	status: 'success' | 'error';
	safeErrorCode: string | null;
	latencyMs: number;
	recordedAt: string;
	contentClasses?: ReadonlyMap<string, OcrContentClass>;
	routeReason?: string;
	shadowSamplePageIds?: ReadonlySet<string>;
}) {
	const results = new Map(input.outcome?.pages.map((page) => [page.pageId, page]) ?? []);
	const contentClasses = input.contentClasses ?? new Map<string, OcrContentClass>();
	const shadowSamples = input.shadowSamplePageIds ?? new Set<string>();
	const routeReason = input.routeReason ?? 'primary_gemini';
	const usage = input.outcome?.usage ?? null;
	const latencyMs = Number.isFinite(input.latencyMs)
		? Math.max(0, Math.min(3_600_000, Math.round(input.latencyMs)))
		: 0;
	const pageMetrics = input.pages.map((page) => {
		const result = results.get(page.pageId);
		return {
			pageId: page.pageId,
			pageNumber: page.pageNumber,
			sourceBytes: page.bytes.byteLength,
			outputCharacters: result?.text.length ?? 0,
			warningCount: result?.warnings.length ?? 0,
			needsReview: result?.needsReview ?? false,
			contentClass: result?.contentClass ?? contentClasses.get(page.pageId) ?? 'unknown',
			routeReason,
			shadowSample: shadowSamples.has(page.pageId)
		};
	});
	return {
		target_event_id: input.eventId,
		target_document_id: input.documentId,
		target_batch_id: input.batchId,
		target_provider: 'gemini',
		target_model: input.model,
		target_provider_model_version: input.outcome?.modelVersion ?? null,
		target_prompt_version: input.promptVersion,
		target_document_kind: input.documentKind,
		terminal_status: input.status,
		target_safe_error_code: input.safeErrorCode,
		target_page_metrics: pageMetrics,
		target_latency_ms: latencyMs,
		target_prompt_token_count: usage?.promptTokenCount ?? null,
		target_cached_content_token_count: usage?.cachedContentTokenCount ?? null,
		target_candidates_token_count: usage?.candidatesTokenCount ?? null,
		target_tool_use_prompt_token_count: usage?.toolUsePromptTokenCount ?? null,
		target_thoughts_token_count: usage?.thoughtsTokenCount ?? null,
		target_total_token_count: usage?.totalTokenCount ?? null,
		target_service_tier: usage?.serviceTier ?? null,
		target_provider_response_id: input.outcome?.responseId ?? null,
		target_usage_details: {
			contentClassificationVersion: OCR_CONTENT_CLASSIFICATION_VERSION,
			...(usage
				? {
						promptTokensDetails: usage.promptTokensDetails,
						cacheTokensDetails: usage.cacheTokensDetails,
						candidatesTokensDetails: usage.candidatesTokensDetails,
						toolUsePromptTokensDetails: usage.toolUsePromptTokensDetails
					}
				: {})
		},
		recorded_at: input.recordedAt
	};
}
