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
	let providerStatus: number | null = null;
	const providerFetch: typeof fetch = async (input, init) => {
		const response = await fetch(input, init);
		providerStatus = response.status;
		if (!response.ok) return response;
		try {
			await response.body?.cancel();
		} catch {
			// No diagnostic output depends on the provider response body.
		}
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
			{ status: response.status, headers: { 'Content-Type': 'application/json' } }
		);
	};

	try {
		const outcome = await requestGeminiOcrBatch({
			apiKey,
			model,
			promptVersion,
			pages: [page],
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
		body = await response.json();
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
		rawBody = await request.json();
	} catch {
		return json(400, {
			...createGeminiDiagnosticResult({
				status: 'fail',
				category: 'request',
				code: 'diagnostic_bad_request',
				httpStatus: 400
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

	const [direct, process] = await Promise.all([runDirectGemini(), runProcessOcr(authorization!)]);
	return json(200, { direct, process });
});
