import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import {
	hashDesktopWorkerCredential,
	parseDesktopWorkerAuthorization
} from '../_shared/desktop-worker-auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LEASE_SECONDS = 120;
const MIN_LEASE_SECONDS = 30;
const MAX_LEASE_SECONDS = 900;
const SOURCE_URL_SECONDS = 60;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const SOURCE_MIME_TYPES = new Set(['image/webp', 'image/jpeg']);

type WorkerRequest =
	| Readonly<{ action: 'claim' }>
	| Readonly<{ action: 'renew' | 'source'; jobId: string; leaseId: string }>;

type DeviceIdentity = Readonly<{
	deviceId: string;
	userId: string;
}>;

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

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseWorkerRequest(value: unknown): WorkerRequest | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (record.action === 'claim' && hasExactKeys(record, ['action'])) {
		return Object.freeze({ action: 'claim' });
	}
	if (
		(record.action === 'renew' || record.action === 'source') &&
		hasExactKeys(record, ['action', 'jobId', 'leaseId']) &&
		typeof record.jobId === 'string' &&
		UUID.test(record.jobId) &&
		typeof record.leaseId === 'string' &&
		UUID.test(record.leaseId)
	) {
		return Object.freeze({ action: record.action, jobId: record.jobId, leaseId: record.leaseId });
	}
	return null;
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

function parseLease(value: unknown, expectedDeviceId: string): Readonly<{
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

function parseSource(value: unknown, expected: WorkerRequest & { action: 'source' }, deviceId: string) {
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

async function sha256Hex(blob: Blob) {
	const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
		rawBody = await request.json();
	} catch {
		return respond(400, { code: 'invalid_json' });
	}
	const input = parseWorkerRequest(rawBody);
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
