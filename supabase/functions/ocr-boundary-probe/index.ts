import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { readBoundedResponseJson } from '../_shared/bounded-response.ts';
import {
	classifyGeminiDiagnosticFailure,
	createGeminiDiagnosticResult,
	decodeGeminiDiagnosticFixture,
	GEMINI_DIAGNOSTIC_BODY,
	GEMINI_DIAGNOSTIC_PAGE,
	hasServiceRoleClaim,
	isOcrBoundaryProbeRequest,
	parseGeminiDiagnosticResult,
	type GeminiDiagnosticResult
} from '../_shared/gemini-diagnostic-contract.ts';
import { requestGeminiOcrBatch } from '../_shared/gemini-ocr-client.ts';

const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const MAX_REQUEST_BODY_BYTES = 1024;
const MAX_WRAPPER_RESPONSE_BYTES = 16 * 1024;

type DirectVariant =
	| 'production'
	| 'without_max_output'
	| 'max_output_only'
	| 'mime_only'
	| 'minimal_json_schema'
	| 'legacy_schema'
	| 'minimal_legacy_schema'
	| 'without_generation_config'
	| 'text_only';

function json(status: number, body: Record<string, unknown>) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store'
		}
	});
}

function configurationFailure(): GeminiDiagnosticResult {
	return createGeminiDiagnosticResult({
		status: 'fail',
		category: 'configuration',
		code: 'provider_not_configured',
		httpStatus: null
	});
}

function syntheticSuccess(page: { pageId: string; pageNumber: number }, status: number) {
	const syntheticText = JSON.stringify({
		pages: [
			{
				pageId: page.pageId,
				pageNumber: page.pageNumber,
				text: '',
				warnings: []
			}
		]
	});
	return new Response(
		JSON.stringify({
			candidates: [{ content: { parts: [{ text: syntheticText }] } }]
		}),
		{ status, headers: { 'Content-Type': 'application/json' } }
	);
}

function clearStructuredOutput(generationConfig: Record<string, unknown>) {
	delete generationConfig.responseFormat;
	delete generationConfig.responseMimeType;
	delete generationConfig.responseJsonSchema;
	delete generationConfig.responseSchema;
}

function toLegacyResponseSchema(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(toLegacyResponseSchema);
	if (value === null || typeof value !== 'object') return value;
	const converted: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		// The legacy Schema surface does not need this JSON-Schema-only strictness;
		// the application parser still rejects unexpected provider fields.
		if (key === 'additionalProperties') continue;
		converted[key] =
			key === 'type' && typeof child === 'string'
				? child.toUpperCase()
				: toLegacyResponseSchema(child);
	}
	return converted;
}

function transformProviderBody(body: Record<string, unknown>, variant: DirectVariant) {
	if (variant === 'production') return body;
	const transformed = structuredClone(body) as Record<string, unknown>;
	const generationConfig =
		transformed.generationConfig && typeof transformed.generationConfig === 'object'
			? (transformed.generationConfig as Record<string, unknown>)
			: null;

	if (variant === 'text_only') {
		transformed.contents = [{ role: 'user', parts: [{ text: 'diagnostic' }] }];
		delete transformed.generationConfig;
		return transformed;
	}
	if (variant === 'without_generation_config') {
		delete transformed.generationConfig;
		return transformed;
	}
	if (!generationConfig) return transformed;

	const productionSchema = generationConfig.responseJsonSchema;

	if (variant === 'without_max_output') {
		delete generationConfig.maxOutputTokens;
		return transformed;
	}
	if (variant === 'max_output_only') {
		clearStructuredOutput(generationConfig);
		return transformed;
	}
	if (variant === 'mime_only') {
		clearStructuredOutput(generationConfig);
		generationConfig.responseMimeType = 'application/json';
		return transformed;
	}
	if (variant === 'minimal_json_schema') {
		clearStructuredOutput(generationConfig);
		generationConfig.responseMimeType = 'application/json';
		generationConfig.responseJsonSchema = {
			type: 'object',
			properties: { ok: { type: 'boolean' } },
			required: ['ok']
		};
		return transformed;
	}
	if (variant === 'legacy_schema') {
		clearStructuredOutput(generationConfig);
		generationConfig.responseMimeType = 'application/json';
		if (productionSchema !== undefined) {
			generationConfig.responseSchema = toLegacyResponseSchema(productionSchema);
		}
		return transformed;
	}
	if (variant === 'minimal_legacy_schema') {
		clearStructuredOutput(generationConfig);
		generationConfig.responseMimeType = 'application/json';
		generationConfig.responseSchema = {
			type: 'OBJECT',
			properties: { ok: { type: 'BOOLEAN' } },
			required: ['ok']
		};
		return transformed;
	}
	return transformed;
}

async function attemptDirectVariant(input: {
	apiKey: string;
	model: string;
	promptVersion: number;
	page: {
		pageId: string;
		pageNumber: number;
		mimeType: string;
		bytes: Uint8Array;
	};
	variant: DirectVariant;
}): Promise<GeminiDiagnosticResult> {
	let providerStatus: number | null = null;
	const providerFetch: typeof fetch = async (url, init) => {
		let nextInit = init;
		if (input.variant !== 'production' && typeof init?.body === 'string') {
			const parsed = JSON.parse(init.body) as Record<string, unknown>;
			nextInit = {
				...init,
				body: JSON.stringify(transformProviderBody(parsed, input.variant))
			};
		}
		const response = await fetch(url, nextInit);
		providerStatus = response.status;
		if (!response.ok) return response;
		try {
			await response.body?.cancel();
		} catch {
			// Provider output is deliberately discarded; diagnostics only need HTTP acceptance.
		}
		return syntheticSuccess(input.page, response.status);
	};

	try {
		const outcome = await requestGeminiOcrBatch({
			apiKey: input.apiKey,
			model: input.model,
			promptVersion: input.promptVersion,
			pages: [input.page],
			fetchImpl: providerFetch
		});
		if (!outcome.valid) {
			return createGeminiDiagnosticResult({
				status: 'fail',
				category: 'provider',
				code: 'provider_response_invalid',
				httpStatus: providerStatus
			});
		}
		return createGeminiDiagnosticResult({
			status: 'pass',
			category: 'provider',
			code: 'provider_ok',
			httpStatus: providerStatus
		});
	} catch (error) {
		return classifyGeminiDiagnosticFailure(error);
	}
}

function isolatedFailure(
	code:
		| 'gemini_response_format_rejected'
		| 'gemini_schema_rejected'
		| 'gemini_schema_complexity_rejected'
		| 'gemini_json_schema_surface_rejected'
		| 'gemini_structured_schema_rejected'
		| 'gemini_image_input_rejected'
		| 'gemini_output_limit_rejected',
	httpStatus: number | null
): GeminiDiagnosticResult {
	return createGeminiDiagnosticResult({
		status: 'fail',
		category: 'request',
		code,
		httpStatus
	});
}

async function runDirectGemini(): Promise<GeminiDiagnosticResult> {
	const apiKey = Deno.env.get('GEMINI_API_KEY');
	const model = Deno.env.get('OCR_MODEL_PRIMARY');
	const promptVersion = Number(Deno.env.get('OCR_PROMPT_VERSION') ?? '1');
	if (
		!apiKey ||
		!model ||
		!MODEL.test(model) ||
		!Number.isInteger(promptVersion) ||
		promptVersion < 1 ||
		promptVersion > 10_000
	) {
		return configurationFailure();
	}

	const page = {
		...GEMINI_DIAGNOSTIC_PAGE,
		bytes: decodeGeminiDiagnosticFixture()
	};
	const attempt = (variant: DirectVariant) =>
		attemptDirectVariant({ apiKey, model, promptVersion, page, variant });

	const production = await attempt('production');
	if (production.success || production.code !== 'gemini_invalid_request') return production;

	// Only a generic provider 400/422 reaches this matrix. Each fallback changes
	// one request surface while keeping the same model, key and fixed fixture.
	const withoutMaxOutput = await attempt('without_max_output');
	if (withoutMaxOutput.success) {
		return isolatedFailure('gemini_output_limit_rejected', production.httpStatus);
	}
	if (withoutMaxOutput.code !== 'gemini_invalid_request') return withoutMaxOutput;

	const maxOutputOnly = await attempt('max_output_only');
	if (!maxOutputOnly.success) {
		if (maxOutputOnly.code !== 'gemini_invalid_request') return maxOutputOnly;
		const withoutGenerationConfig = await attempt('without_generation_config');
		if (withoutGenerationConfig.success) {
			return isolatedFailure('gemini_output_limit_rejected', production.httpStatus);
		}
		if (withoutGenerationConfig.code !== 'gemini_invalid_request') return withoutGenerationConfig;
		const textOnly = await attempt('text_only');
		if (textOnly.success) {
			return isolatedFailure('gemini_image_input_rejected', production.httpStatus);
		}
		return textOnly.code === 'gemini_invalid_request' ? production : textOnly;
	}

	const mimeOnly = await attempt('mime_only');
	if (!mimeOnly.success) {
		return mimeOnly.code === 'gemini_invalid_request'
			? isolatedFailure('gemini_response_format_rejected', production.httpStatus)
			: mimeOnly;
	}

	const minimalJsonSchema = await attempt('minimal_json_schema');
	if (minimalJsonSchema.success) {
		return isolatedFailure('gemini_schema_complexity_rejected', production.httpStatus);
	}
	if (minimalJsonSchema.code !== 'gemini_invalid_request') return minimalJsonSchema;

	const legacySchema = await attempt('legacy_schema');
	if (legacySchema.success) {
		return isolatedFailure('gemini_json_schema_surface_rejected', production.httpStatus);
	}
	if (legacySchema.code !== 'gemini_invalid_request') return legacySchema;

	const minimalLegacySchema = await attempt('minimal_legacy_schema');
	if (minimalLegacySchema.success) {
		return isolatedFailure('gemini_json_schema_surface_rejected', production.httpStatus);
	}
	if (minimalLegacySchema.code !== 'gemini_invalid_request') return minimalLegacySchema;

	return isolatedFailure('gemini_structured_schema_rejected', production.httpStatus);
}

async function runProcessOcr(authorization: string): Promise<GeminiDiagnosticResult> {
	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	if (!supabaseUrl) {
		return createGeminiDiagnosticResult({
			status: 'fail',
			category: 'configuration',
			code: 'provider_not_configured',
			httpStatus: null
		});
	}
	const serviceRoleKey = authorization.slice('Bearer '.length).trim();
	let response: Response;
	try {
		response = await fetch(`${supabaseUrl}/functions/v1/process-ocr`, {
			method: 'POST',
			headers: {
				Authorization: authorization,
				apikey: serviceRoleKey,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(GEMINI_DIAGNOSTIC_BODY)
		});
	} catch {
		return createGeminiDiagnosticResult({
			status: 'fail',
			category: 'transport',
			code: 'provider_transport_failed',
			httpStatus: null
		});
	}
	let body: unknown = null;
	try {
		body = await readBoundedResponseJson(response, MAX_WRAPPER_RESPONSE_BYTES);
	} catch {
		return createGeminiDiagnosticResult({
			status: 'fail',
			category: 'wrapper',
			code: 'wrapper_response_invalid',
			httpStatus: response.status
		});
	}
	const parsed = parseGeminiDiagnosticResult(body);
	if (parsed) return parsed;
	return createGeminiDiagnosticResult({
		status: 'fail',
		category: 'wrapper',
		code: response.ok ? 'wrapper_response_invalid' : 'wrapper_http_failed',
		httpStatus: response.status
	});
}

Deno.serve(async (request) => {
	if (request.method !== 'POST') {
		return json(405, {
			...createGeminiDiagnosticResult({
				status: 'fail',
				category: 'request',
				code: 'diagnostic_bad_request',
				httpStatus: 405
			})
		});
	}

	const authorization = request.headers.get('Authorization');
	if (!hasServiceRoleClaim(authorization)) {
		return json(403, {
			...createGeminiDiagnosticResult({
				status: 'fail',
				category: 'authorization',
				code: 'diagnostic_forbidden',
				httpStatus: 403
			})
		});
	}

	let rawBody: unknown;
	try {
		rawBody = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES);
	} catch (error) {
		const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
		return json(status, {
			...createGeminiDiagnosticResult({
				status: 'fail',
				category: 'request',
				code: 'diagnostic_bad_request',
				httpStatus: status
			})
		});
	}
	if (!isOcrBoundaryProbeRequest(rawBody)) {
		return json(400, {
			...createGeminiDiagnosticResult({
				status: 'fail',
				category: 'request',
				code: 'diagnostic_bad_request',
				httpStatus: 400
			})
		});
	}

	// Run sequentially to avoid the probe itself creating concurrent provider load.
	const direct = await runDirectGemini();
	const process = await runProcessOcr(authorization!);
	return json(200, { direct, process });
});
