import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
	GeminiEmbeddingHttpError,
	GeminiEmbeddingResponseError,
	GeminiEmbeddingTransportError,
	requestGeminiEmbeddings,
	type GeminiEmbeddingInput,
	type GeminiEmbeddingTask
} from './gemini-embedding-client.ts';

type SemanticOperation = 'document_embedding' | 'query_embedding';
type SemanticSurface = 'coverage' | 'search' | 'indexer';

function safeError(error: unknown) {
	if (error instanceof GeminiEmbeddingHttpError) {
		return {
			code: error.status === 429 ? 'rate_limited' : 'provider_http_error',
			httpStatus: error.status
		};
	}
	if (error instanceof GeminiEmbeddingTransportError) {
		return { code: 'provider_transport_error', httpStatus: null };
	}
	if (error instanceof GeminiEmbeddingResponseError) {
		return { code: 'provider_response_error', httpStatus: null };
	}
	if (error instanceof DOMException && error.name === 'AbortError') {
		return { code: 'aborted', httpStatus: null };
	}
	return { code: 'provider_unknown_error', httpStatus: null };
}

function inputMetrics(inputs: readonly GeminiEmbeddingInput[]) {
	const encoder = new TextEncoder();
	let characters = 0;
	let bytes = 0;
	for (const input of inputs) {
		const title = input.title ?? '';
		characters += input.text.length + title.length;
		bytes += encoder.encode(input.text).byteLength + encoder.encode(title).byteLength;
	}
	return { characters, bytes };
}

async function persistTelemetry(
	supabase: SupabaseClient,
	input: {
		model: string;
		operation: SemanticOperation;
		surface: SemanticSurface;
		status: 'success' | 'error';
		safeErrorCode: string | null;
		httpStatus: number | null;
		inputCount: number;
		inputCharacters: number;
		inputBytes: number;
		outputDimensions: number;
		latencyMs: number;
	}
) {
	try {
		await supabase.rpc('record_semantic_provider_usage', {
			target_event_id: crypto.randomUUID(),
			target_provider: 'gemini',
			target_model: input.model,
			target_operation: input.operation,
			target_surface: input.surface,
			terminal_status: input.status,
			target_safe_error_code: input.safeErrorCode,
			target_http_status: input.httpStatus,
			target_input_count: input.inputCount,
			target_input_characters: input.inputCharacters,
			target_input_bytes: input.inputBytes,
			target_output_dimensions: input.outputDimensions,
			target_latency_ms: Math.max(0, Math.min(3_600_000, Math.round(input.latencyMs))),
			recorded_at: new Date().toISOString()
		});
	} catch {
		// Telemetry is best effort and must never make semantic retrieval fail.
	}
}

export async function requestGeminiEmbeddingsWithTelemetry(input: {
	supabase: SupabaseClient;
	apiKey: string;
	model: string;
	inputs: readonly GeminiEmbeddingInput[];
	taskType: GeminiEmbeddingTask;
	outputDimensionality: number;
	operation: SemanticOperation;
	surface: SemanticSurface;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}) {
	const metrics = inputMetrics(input.inputs);
	const startedAt = performance.now();
	try {
		const result = await requestGeminiEmbeddings({
			apiKey: input.apiKey,
			model: input.model,
			inputs: input.inputs,
			taskType: input.taskType,
			outputDimensionality: input.outputDimensionality,
			...(input.signal ? { signal: input.signal } : {}),
			...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {})
		});
		await persistTelemetry(input.supabase, {
			model: input.model,
			operation: input.operation,
			surface: input.surface,
			status: 'success',
			safeErrorCode: null,
			httpStatus: null,
			inputCount: input.inputs.length,
			inputCharacters: metrics.characters,
			inputBytes: metrics.bytes,
			outputDimensions: input.outputDimensionality,
			latencyMs: performance.now() - startedAt
		});
		return result;
	} catch (error) {
		const safe = safeError(error);
		await persistTelemetry(input.supabase, {
			model: input.model,
			operation: input.operation,
			surface: input.surface,
			status: 'error',
			safeErrorCode: safe.code,
			httpStatus: safe.httpStatus,
			inputCount: input.inputs.length,
			inputCharacters: metrics.characters,
			inputBytes: metrics.bytes,
			outputDimensions: input.outputDimensionality,
			latencyMs: performance.now() - startedAt
		});
		throw error;
	}
}
