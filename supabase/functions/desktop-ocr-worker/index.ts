import { createClient } from 'npm:@supabase/supabase-js@2';
import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import {
	hashDesktopWorkerCredential,
	parseDesktopWorkerAuthorization
} from '../_shared/desktop-worker-auth.ts';
import {
	parseDesktopWorkerRequest,
	type DesktopWorkerRequest
} from '../_shared/desktop-worker-contract.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DEFAULT_LEASE_SECONDS = 120;
const MIN_LEASE_SECONDS = 30;
const MAX_LEASE_SECONDS = 900;
const SOURCE_URL_SECONDS = 60;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const SOURCE_MIME_TYPES = new Set(['image/webp', 'image/jpeg']);

type DeviceIdentity = Readonly<{
	deviceId: string;
	userId: string;
}>;
type SourceRequest = Extract<DesktopWorkerRequest, { action: 'source' }>;
type CompleteRequest = Extract<DesktopWorkerRequest, { action: 'complete' }>;

function responseHeaders(appOrigin: string | null) {
	return {
		...corsHeaders(appOrigin),
		'Cache-Control': 'no-store',
		'Referrer-Policy': 'no-referrer'
	};
}

function json(status: number, body: Record<string, unknown>, appOrigin: string | null) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...responseHeaders(appOrigin), 'Content-Type': 'application/json' }
	});
}

function empty(status: number, appOrigin: string | null) {
	return new Response(null, { status, headers: responseHeaders(appOrigin) });
}

function envLeaseSeconds() {
	const raw = Deno.env.get('DESKTOP_OCR_LEASE_SECONDS');
	if (raw === undefined || raw === '') return DEFAULT_LEASE_SECONDS;
	const value = Number(raw);
	return Number.isInteger(value) && value >= MIN_LEASE_SECONDS && value <= MAX_LEASE_SECONDS
		? value
		: null;
}

function parseDeviceIdentity(value: unknown): DeviceIdentity | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		typeof record.deviceId !== 'string' ||
		!UUID.test(record.deviceId) ||
		typeof record.userId !== 'string' ||
		!UUID.test(record.userId)
	) {
		return null;
	}
	return Object.freeze({ deviceId: record.deviceId, userId: record.userId });
}

function parseLease(
	value: unknown,
	expectedDeviceId: string
): Readonly<{
	jobId: string;
	pageId: string;
	deviceId: string;
	leaseId: string;
	leaseExpiresAt: string;
}> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		typeof record.jobId !== 'string' ||
		!UUID.test(record.jobId) ||
		typeof record.pageId !== 'string' ||
		!UUID.test(record.pageId) ||
		record.deviceId !== expectedDeviceId ||
		typeof record.leaseId !== 'string' ||
		!UUID.test(record.leaseId) ||
		typeof record.leaseExpiresAt !== 'string' ||
		!Number.isFinite(Date.parse(record.leaseExpiresAt))
	) {
		return null;
	}
	return Object.freeze({
		jobId: record.jobId,
		pageId: record.pageId,
		deviceId: record.deviceId,
		leaseId: record.leaseId,
		leaseExpiresAt: record.leaseExpiresAt
	});
}

function parseSource(value: unknown, expected: SourceRequest, deviceId: string) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		record.jobId !== expected.jobId ||
		typeof record.userId !== 'string' ||
		!UUID.test(record.userId) ||
		typeof record.pageId !== 'string' ||
		!UUID.test(record.pageId) ||
		typeof record.documentId !== 'string' ||
		!UUID.test(record.documentId) ||
		typeof record.pageNumber !== 'number' ||
		!Number.isInteger(record.pageNumber) ||
		record.pageNumber < 1 ||
		typeof record.storagePath !== 'string' ||
		record.storagePath.length < 3 ||
		record.storagePath.length > 1024 ||
		typeof record.leaseExpiresAt !== 'string' ||
		!Number.isFinite(Date.parse(record.leaseExpiresAt))
	) {
		return null;
	}
	return Object.freeze({
		jobId: expected.jobId,
		deviceId,
		leaseId: expected.leaseId,
		userId: record.userId,
		pageId: record.pageId,
		documentId: record.documentId,
		pageNumber: record.pageNumber,
		storagePath: record.storagePath,
		leaseExpiresAt: record.leaseExpiresAt
	});
}

function sourceBindingMatches(
	value: unknown,
	expected: Readonly<{
		jobId: string;
		pageId: string;
		deviceId: string;
		leaseId: string;
		sha256: string;
	}>
) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		record.jobId === expected.jobId &&
		record.pageId === expected.pageId &&
		record.deviceId === expected.deviceId &&
		record.leaseId === expected.leaseId &&
		record.sourceSha256 === expected.sha256 &&
		typeof record.sourceBoundAt === 'string' &&
		Number.isFinite(Date.parse(record.sourceBoundAt))
	);
}

function parseCompletion(value: unknown, expected: CompleteRequest) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		record.jobId !== expected.jobId ||
		typeof record.pageId !== 'string' ||
		!UUID.test(record.pageId) ||
		typeof record.resultId !== 'string' ||
		!UUID.test(record.resultId) ||
		(record.status !== 'ready' && record.status !== 'needs_review') ||
		(record.sourceStoragePath !== null &&
			(typeof record.sourceStoragePath !== 'string' ||
				record.sourceStoragePath.length < 3 ||
				record.sourceStoragePath.length > 1024)) ||
		typeof record.idempotentReplay !== 'boolean'
	) {
		return null;
	}
	return Object.freeze({
		jobId: expected.jobId,
		pageId: record.pageId,
		resultId: record.resultId,
		status: record.status,
		sourceStoragePath: record.sourceStoragePath,
		idempotentReplay: record.idempotentReplay
	});
}

async function sha256Hex(blob: Blob) {
	const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
	const value = [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	if (!SHA256_HEX.test(value)) throw new Error('Unexpected SHA-256 encoding');
	return value;
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);

	if (!appOrigin) return respond(503, { code: 'desktop_ocr_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const credential = parseDesktopWorkerAuthorization(request.headers.get('Authorization'));
	if (!credential) return respond(401, { code: 'worker_authentication_required' });
	const digestHex = await hashDesktopWorkerCredential(credential);
	if (!digestHex) return respond(401, { code: 'worker_authentication_required' });

	let rawBody: unknown;
	try {
		rawBody = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES);
	} catch (error) {
		return error instanceof RequestBodyTooLargeError
			? respond(413, { code: 'worker_request_too_large' })
			: respond(400, { code: 'invalid_json' });
	}
	const input = parseDesktopWorkerRequest(rawBody);
	if (!input) return respond(400, { code: 'invalid_worker_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	const leaseSeconds = envLeaseSeconds();
	if (!supabaseUrl || !serviceRoleKey || leaseSeconds === null) {
		return respond(503, { code: 'desktop_ocr_not_configured' });
	}
	const admin = createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data: authenticated, error: authenticationError } = await admin.rpc(
		'authenticate_ocr_worker_device',
		{ digest_hex: digestHex }
	);
	if (authenticationError) return respond(503, { code: 'worker_authentication_failed' });
	const device = parseDeviceIdentity(authenticated);
	if (!device) return respond(401, { code: 'worker_authentication_required' });

	if (input.action === 'claim') {
		const leaseId = crypto.randomUUID();
		const { data, error } = await admin.rpc('claim_desktop_ocr_job', {
			target_user_id: device.userId,
			target_device_id: device.deviceId,
			target_lease_id: leaseId,
			lease_seconds: leaseSeconds
		});
		if (error) return respond(503, { code: 'desktop_ocr_claim_failed' });
		if (data === null) return empty(204, appOrigin);
		const lease = parseLease(data, device.deviceId);
		if (!lease || lease.leaseId !== leaseId) {
			return respond(503, { code: 'desktop_ocr_claim_failed' });
		}
		return respond(200, lease);
	}

	if (input.action === 'renew') {
		const { data, error } = await admin.rpc('renew_desktop_ocr_job_lease', {
			target_job_id: input.jobId,
			target_device_id: device.deviceId,
			target_lease_id: input.leaseId,
			lease_seconds: leaseSeconds
		});
		if (error) return respond(409, { code: 'desktop_ocr_lease_not_active' });
		const lease = parseLease(data, device.deviceId);
		if (!lease || lease.jobId !== input.jobId || lease.leaseId !== input.leaseId) {
			return respond(503, { code: 'desktop_ocr_renew_failed' });
		}
		return respond(200, lease);
	}

	if (input.action === 'complete') {
		const { data, error } = await admin.rpc('complete_desktop_ocr_job_with_geometry', {
			target_job_id: input.jobId,
			target_device_id: device.deviceId,
			target_lease_id: input.leaseId,
			target_source_sha256: input.sourceSha256,
			target_backend: input.backend,
			target_model: input.modelId,
			target_model_version: input.modelVersion,
			extracted_text: input.rawText,
			target_corrected_text: input.correctedText,
			target_content_type: input.contentType,
			extraction_warnings: input.warnings,
			needs_review: input.needsReview,
			timing_ms: input.timingMs,
			geometry_payload: input.wordGeometry
		});
		if (error) return respond(409, { code: 'desktop_ocr_completion_rejected' });
		const completion = parseCompletion(data, input);
		if (!completion) return respond(503, { code: 'desktop_ocr_completion_failed' });

		let cleanupPending = completion.sourceStoragePath !== null;
		if (completion.sourceStoragePath !== null) {
			const { error: removeError } = await admin.storage
				.from('documents')
				.remove([completion.sourceStoragePath]);
			if (!removeError) {
				const { data: cleared, error: clearError } = await admin.rpc(
					'clear_desktop_ocr_completed_source',
					{
						target_job_id: completion.jobId,
						target_result_id: completion.resultId,
						expected_storage_path: completion.sourceStoragePath
					}
				);
				cleanupPending = clearError !== null || cleared !== true;
			}
		}

		return respond(200, {
			jobId: completion.jobId,
			pageId: completion.pageId,
			resultId: completion.resultId,
			status: completion.status,
			idempotentReplay: completion.idempotentReplay,
			cleanupPending
		});
	}

	const { data, error } = await admin.rpc('get_desktop_ocr_job_source', {
		target_job_id: input.jobId,
		target_device_id: device.deviceId,
		target_lease_id: input.leaseId
	});
	if (error) return respond(409, { code: 'desktop_ocr_source_not_active' });
	const source = parseSource(data, input, device.deviceId);
	if (!source || source.userId !== device.userId) {
		return respond(503, { code: 'desktop_ocr_source_failed' });
	}

	const { data: sourceBlob, error: sourceError } = await admin.storage
		.from('documents')
		.download(source.storagePath);
	if (sourceError || !sourceBlob) return respond(503, { code: 'desktop_ocr_source_unavailable' });
	if (sourceBlob.size < 1 || sourceBlob.size > MAX_SOURCE_BYTES) {
		return respond(413, { code: 'desktop_ocr_source_size_invalid' });
	}
	if (!SOURCE_MIME_TYPES.has(sourceBlob.type)) {
		return respond(415, { code: 'desktop_ocr_source_type_invalid' });
	}
	const sourceSha256 = await sha256Hex(sourceBlob);
	const { data: binding, error: bindingError } = await admin.rpc(
		'bind_desktop_ocr_job_source_hash',
		{
			target_job_id: source.jobId,
			target_device_id: device.deviceId,
			target_lease_id: source.leaseId,
			target_source_sha256: sourceSha256
		}
	);
	if (bindingError) return respond(409, { code: 'desktop_ocr_source_changed' });
	if (
		!sourceBindingMatches(binding, {
			jobId: source.jobId,
			pageId: source.pageId,
			deviceId: device.deviceId,
			leaseId: source.leaseId,
			sha256: sourceSha256
		})
	) {
		return respond(503, { code: 'desktop_ocr_source_binding_failed' });
	}

	const { data: signed, error: signedError } = await admin.storage
		.from('documents')
		.createSignedUrl(source.storagePath, SOURCE_URL_SECONDS);
	if (signedError || !signed?.signedUrl) {
		return respond(503, { code: 'desktop_ocr_source_delivery_failed' });
	}

	return respond(200, {
		jobId: source.jobId,
		pageId: source.pageId,
		documentId: source.documentId,
		pageNumber: source.pageNumber,
		leaseId: source.leaseId,
		leaseExpiresAt: source.leaseExpiresAt,
		sourceUrl: signed.signedUrl,
		sourceUrlExpiresInSeconds: SOURCE_URL_SECONDS,
		sourceSha256,
		mimeType: sourceBlob.type,
		sourceBytes: sourceBlob.size
	});
});
