import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { claimStateHttpStatus, classifyGeminiFailure } from '../_shared/ocr-contract.ts';
import {
	GeminiHttpError,
	GeminiResponseError,
	GeminiTransportError,
	requestGeminiOcr
} from '../_shared/gemini-ocr-client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const MAX_INLINE_IMAGE_BYTES = 14 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 55_000;

function json(status: number, body: Record<string, unknown>, appOrigin: string | null) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders(appOrigin),
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store'
		}
	});
}

function empty(status: number, appOrigin: string | null) {
	return new Response(null, {
		status,
		headers: { ...corsHeaders(appOrigin), 'Cache-Control': 'no-store' }
	});
}

function retryAt(attemptCount: number, baseSeconds: number) {
	const exponent = Math.min(Math.max(attemptCount - 1, 0), 6);
	const jitter = crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
	const delayMs = Math.min(60 * 60 * 1000, baseSeconds * 1000 * 2 ** exponent + jitter);
	return new Date(Date.now() + delayMs).toISOString();
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);

	if (!appOrigin) return respond(503, { code: 'ocr_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) {
		return respond(401, { code: 'authentication_required' });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return respond(400, { code: 'invalid_json' });
	}
	if (
		body === null ||
		typeof body !== 'object' ||
		Array.isArray(body) ||
		Object.keys(body).length !== 1 ||
		typeof (body as { pageId?: unknown }).pageId !== 'string' ||
		!UUID.test((body as { pageId: string }).pageId)
	) {
		return respond(400, { code: 'invalid_page_id' });
	}
	const pageId = (body as { pageId: string }).pageId;

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	const apiKey = Deno.env.get('GEMINI_API_KEY');
	const model = Deno.env.get('OCR_MODEL_PRIMARY');
	const promptVersion = Number(Deno.env.get('OCR_PROMPT_VERSION') ?? '1');
	const dailyLimit = Number(Deno.env.get('OCR_DAILY_HARD_LIMIT') ?? '0');
	if (
		!supabaseUrl ||
		!publishableKey ||
		!apiKey ||
		!model ||
		!MODEL.test(model) ||
		!Number.isInteger(promptVersion) ||
		promptVersion < 1 ||
		!Number.isInteger(dailyLimit) ||
		dailyLimit < 1
	) {
		return respond(503, { code: 'ocr_not_configured' });
	}

	const supabase = createClient(supabaseUrl, publishableKey, {
		global: { headers: { Authorization: authorization } },
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();
	if (userError || !user) return respond(401, { code: 'authentication_required' });

	const { data: page, error: pageError } = await supabase
		.from('pages')
		.select('id,status,temporary_image_path,document_id,ocr_raw_text,corrected_text')
		.eq('id', pageId)
		.maybeSingle();
	if (pageError) return respond(503, { code: 'page_lookup_failed' });
	if (!page) return respond(404, { code: 'page_not_found' });

	const cleanupTemporaryImage = async (path: string | null) => {
		if (!path) return;
		const { error } = await supabase.storage.from('documents').remove([path]);
		if (!error) {
			await supabase.rpc('clear_temporary_page_image', {
				target_page_id: pageId,
				expected_storage_path: path
			});
		}
	};

	if (
		['ready', 'needs_review'].includes(page.status) &&
		(typeof page.corrected_text === 'string' || typeof page.ocr_raw_text === 'string')
	) {
		await cleanupTemporaryImage(page.temporary_image_path);
		return respond(200, { state: 'already_complete' });
	}

	const claimedAt = new Date().toISOString();
	const { data: claim, error: claimError } = await supabase.rpc('claim_ocr_job', {
		target_page_id: pageId,
		target_model: model,
		claimed_at: claimedAt,
		daily_hard_limit: dailyLimit
	});
	if (claimError || !claim || typeof claim !== 'object') {
		return respond(503, { code: 'ocr_claim_failed' });
	}
	const claimState = (claim as { state?: unknown }).state;
	if (claimState !== 'claimed') {
		return respond(claimStateHttpStatus(claimState), {
			state: claimState ?? 'claim_rejected'
		});
	}
	const attemptCount = Number((claim as { attemptCount?: unknown }).attemptCount ?? 1);

	const { data: document, error: documentError } = await supabase
		.from('documents')
		.select('kind,storage_path')
		.eq('id', page.document_id)
		.maybeSingle();
	if (documentError || !document) {
		await supabase.rpc('fail_ocr_job', {
			target_page_id: pageId,
			error_code: 'ocr_source_missing',
			safe_error_message: 'O arquivo original não está disponível.',
			retryable: false,
			failed_at: new Date().toISOString(),
			retry_at: null
		});
		return respond(409, { code: 'ocr_source_missing' });
	}
	const sourcePath = page.temporary_image_path ?? (document.kind === 'image' ? document.storage_path : null);
	if (!sourcePath) {
		await supabase.rpc('fail_ocr_job', {
			target_page_id: pageId,
			error_code: 'ocr_source_missing',
			safe_error_message: 'A página ainda não foi preparada para leitura.',
			retryable: false,
			failed_at: new Date().toISOString(),
			retry_at: null
		});
		return respond(409, { code: 'ocr_source_missing' });
	}

	const { data: sourceBlob, error: sourceError } = await supabase.storage
		.from('documents')
		.download(sourcePath);
	if (sourceError || !sourceBlob) {
		const failedAt = new Date();
		await supabase.rpc('fail_ocr_job', {
			target_page_id: pageId,
			error_code: 'ocr_source_unavailable',
			safe_error_message: 'A página não pôde ser carregada do armazenamento.',
			retryable: true,
			failed_at: failedAt.toISOString(),
			retry_at: retryAt(attemptCount, 30)
		});
		return respond(503, { code: 'ocr_source_unavailable', retryable: true });
	}
	if (sourceBlob.size > MAX_INLINE_IMAGE_BYTES) {
		await supabase.rpc('fail_ocr_job', {
			target_page_id: pageId,
			error_code: 'ocr_source_too_large',
			safe_error_message: 'A página excede o limite seguro para leitura inline.',
			retryable: false,
			failed_at: new Date().toISOString(),
			retry_at: null
		});
		return respond(413, { code: 'ocr_source_too_large' });
	}

	let bytes: Uint8Array | null = null;
	const timeout = new AbortController();
	const timeoutId = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
	try {
		bytes = new Uint8Array(await sourceBlob.arrayBuffer());
		const result = await requestGeminiOcr({
			apiKey,
			model,
			mimeType: sourceBlob.type || 'image/jpeg',
			bytes,
			promptVersion,
			signal: timeout.signal
		});
		const completedAt = new Date().toISOString();
		const { data: completed, error: completionError } = await supabase.rpc('complete_ocr_job', {
			target_page_id: pageId,
			extracted_text: result.text,
			extraction_warnings: result.warnings,
			terminal_status: result.needsReview ? 'needs_review' : 'ready',
			completed_at: completedAt
		});
		if (completionError || completed !== true) {
			return respond(503, { code: 'ocr_completion_failed' });
		}

		await cleanupTemporaryImage(page.temporary_image_path);
		return respond(200, {
			state: 'complete',
			needsReview: result.needsReview,
			warningCount: result.warnings.length
		});
	} catch (error) {
		if (error instanceof GeminiHttpError) {
			const failure = classifyGeminiFailure(error.status, error.responseBody);
			if (failure.quotaExhausted) {
				await supabase.rpc('block_ocr_job_quota', {
					target_page_id: pageId,
					error_code: failure.code,
					blocked_at: new Date().toISOString()
				});
			} else {
				const failedAt = new Date();
				await supabase.rpc('fail_ocr_job', {
					target_page_id: pageId,
					error_code: failure.code,
					safe_error_message: failure.safeMessage,
					retryable: failure.retryable,
					failed_at: failedAt.toISOString(),
					retry_at:
						failure.retryable && failure.delaySeconds
							? retryAt(attemptCount, failure.delaySeconds)
							: null
				});
			}
			const providerStatus = error.status >= 400 && error.status <= 599 ? error.status : 502;
			return respond(failure.quotaExhausted ? 429 : failure.retryable ? 503 : providerStatus, {
				code: failure.code,
				retryable: failure.retryable
			});
		}

		const retryable = attemptCount < 3;
		const failedAt = new Date();
		const responseInvalid = error instanceof GeminiResponseError;
		const requestInterrupted =
			error instanceof GeminiTransportError ||
			(error instanceof DOMException && error.name === 'AbortError');
		const code = responseInvalid ? 'ocr_response_invalid' : 'ocr_request_failed';
		await supabase.rpc('fail_ocr_job', {
			target_page_id: pageId,
			error_code: code,
			safe_error_message: responseInvalid
				? 'O provedor retornou um formato de transcrição inválido.'
				: requestInterrupted
					? 'A solicitação de leitura foi interrompida.'
					: 'A leitura falhou antes de produzir um resultado válido.',
			retryable,
			failed_at: failedAt.toISOString(),
			retry_at: retryable ? retryAt(attemptCount, 45) : null
		});
		return respond(retryable ? 503 : responseInvalid ? 422 : 503, { code, retryable });
	} finally {
		clearTimeout(timeoutId);
		bytes?.fill(0);
	}
});
