import { createClient } from 'npm:@supabase/supabase-js@2';
import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { generateDesktopWorkerCredential } from '../_shared/desktop-worker-auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAIRING_CODE = /^[0-9A-Fa-f]{4}(-[0-9A-Fa-f]{4}){3}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_CAPABILITIES_BYTES = 12 * 1024;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

type PairRequest = Readonly<{
	action: 'pair';
	label: string;
	capabilities: Readonly<Record<string, unknown>>;
}>;

type RedeemRequest = Readonly<{
	action: 'redeem';
	pairingCode: string;
	label: string;
	capabilities: Readonly<Record<string, unknown>>;
	credentialDigest: string;
}>;

type RevokeRequest = Readonly<{
	action: 'revoke';
	deviceId: string;
}>;

type WorkerDeviceRequest = PairRequest | RedeemRequest | RevokeRequest;

function json(status: number, body: Record<string, unknown>, appOrigin: string | null) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders(appOrigin),
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer'
		}
	});
}

function empty(status: number, appOrigin: string | null) {
	return new Response(null, {
		status,
		headers: {
			...corsHeaders(appOrigin),
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer'
		}
	});
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseLabel(value: unknown): string | null {
	if (typeof value !== 'string' || value !== value.trim()) return null;
	if (
		value.length < 1 ||
		value.length > 80 ||
		// eslint-disable-next-line no-control-regex -- reject ASCII controls from a device label
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		return null;
	}
	return value;
}

function parseCapabilities(value: unknown): Readonly<Record<string, unknown>> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		return null;
	}
	if (new TextEncoder().encode(serialized).byteLength > MAX_CAPABILITIES_BYTES) return null;
	return Object.freeze({ ...(value as Record<string, unknown>) });
}

function parsePairRequest(record: Record<string, unknown>): PairRequest | null {
	if (!hasExactKeys(record, ['label', 'capabilities'])) return null;
	const label = parseLabel(record.label);
	const capabilities = parseCapabilities(record.capabilities);
	if (!label || !capabilities) return null;
	return Object.freeze({ action: 'pair', label, capabilities });
}

function parseRedeemRequest(record: Record<string, unknown>): RedeemRequest | null {
	if (
		!hasExactKeys(record, ['action', 'pairingCode', 'label', 'capabilities', 'credentialDigest'])
	) {
		return null;
	}
	const label = parseLabel(record.label);
	const capabilities = parseCapabilities(record.capabilities);
	if (
		record.action !== 'redeem' ||
		typeof record.pairingCode !== 'string' ||
		!PAIRING_CODE.test(record.pairingCode) ||
		typeof record.credentialDigest !== 'string' ||
		!SHA256_HEX.test(record.credentialDigest) ||
		!label ||
		!capabilities
	) {
		return null;
	}
	return Object.freeze({
		action: 'redeem',
		pairingCode: record.pairingCode.toUpperCase(),
		label,
		capabilities,
		credentialDigest: record.credentialDigest
	});
}

function parseWorkerDeviceRequest(value: unknown): WorkerDeviceRequest | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (record.action === 'redeem') return parseRedeemRequest(record);
	if (hasExactKeys(record, ['action', 'deviceId'])) {
		return record.action === 'revoke' &&
			typeof record.deviceId === 'string' &&
			UUID.test(record.deviceId)
			? Object.freeze({ action: 'revoke', deviceId: record.deviceId })
			: null;
	}
	return parsePairRequest(record);
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value as Record<string, unknown>)
			.sort()
			.map(
				(key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
			)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function parseRegisteredDevice(value: unknown): Readonly<{
	deviceId: string;
	label: string;
	status: string;
	capabilities: unknown;
	createdAt: string;
}> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		typeof record.deviceId !== 'string' ||
		!UUID.test(record.deviceId) ||
		typeof record.label !== 'string' ||
		record.status !== 'active' ||
		record.capabilities === null ||
		typeof record.capabilities !== 'object' ||
		Array.isArray(record.capabilities) ||
		typeof record.createdAt !== 'string' ||
		!Number.isFinite(Date.parse(record.createdAt))
	) {
		return null;
	}
	return Object.freeze({
		deviceId: record.deviceId,
		label: record.label,
		status: record.status,
		capabilities: record.capabilities,
		createdAt: record.createdAt
	});
}

function parseRevokedDevice(
	value: unknown,
	expectedDeviceId: string
): Readonly<{
	deviceId: string;
	status: 'revoked';
	revokedAt: string;
	requeuedJobs: number;
}> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		record.deviceId !== expectedDeviceId ||
		record.status !== 'revoked' ||
		typeof record.revokedAt !== 'string' ||
		!Number.isFinite(Date.parse(record.revokedAt)) ||
		!Number.isSafeInteger(record.requeuedJobs) ||
		(record.requeuedJobs as number) < 0
	) {
		return null;
	}
	return Object.freeze({
		deviceId: expectedDeviceId,
		status: 'revoked',
		revokedAt: record.revokedAt,
		requeuedJobs: record.requeuedJobs as number
	});
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);

	if (!appOrigin) return respond(503, { code: 'desktop_ocr_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	let rawBody: unknown;
	try {
		rawBody = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES);
	} catch (error) {
		return error instanceof RequestBodyTooLargeError
			? respond(413, { code: 'pair_request_too_large' })
			: respond(400, { code: 'invalid_json' });
	}
	const input = parseWorkerDeviceRequest(rawBody);
	if (!input) return respond(400, { code: 'invalid_pair_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	if (!supabaseUrl || !publishableKey) {
		return respond(503, { code: 'desktop_ocr_not_configured' });
	}

	if (input.action === 'redeem') {
		const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
		if (!serviceRoleKey) return respond(503, { code: 'desktop_ocr_not_configured' });
		const admin = createClient(supabaseUrl, serviceRoleKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
		const { data, error } = await admin.rpc('redeem_ocr_worker_pairing_code', {
			pairing_code: input.pairingCode,
			device_label: input.label,
			digest_hex: input.credentialDigest,
			device_capabilities: input.capabilities
		});
		if (error) return respond(409, { code: 'desktop_ocr_pairing_code_unavailable' });
		const device = parseRegisteredDevice(data);
		if (
			!device ||
			device.label !== input.label ||
			canonicalJson(device.capabilities) !== canonicalJson(input.capabilities)
		) {
			return respond(503, { code: 'desktop_ocr_pair_failed' });
		}
		return respond(201, {
			deviceId: device.deviceId,
			label: device.label,
			status: device.status,
			capabilities: device.capabilities,
			createdAt: device.createdAt
		});
	}

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) {
		return respond(401, { code: 'authentication_required' });
	}

	const userClient = createClient(supabaseUrl, publishableKey, {
		global: { headers: { Authorization: authorization } },
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const {
		data: { user },
		error: userError
	} = await userClient.auth.getUser();
	if (userError || !user) return respond(401, { code: 'authentication_required' });

	const { data: allowed, error: allowedError } = await userClient
		.from('app_users')
		.select('is_active')
		.eq('user_id', user.id)
		.eq('is_active', true)
		.maybeSingle();
	if (allowedError || !allowed) return respond(403, { code: 'desktop_ocr_forbidden' });

	if (input.action === 'revoke') {
		const { data, error } = await userClient.rpc('revoke_ocr_worker_device', {
			target_device_id: input.deviceId
		});
		if (error) return respond(503, { code: 'desktop_ocr_revoke_failed' });
		const revoked = parseRevokedDevice(data, input.deviceId);
		if (!revoked) return respond(503, { code: 'desktop_ocr_revoke_failed' });
		return respond(200, {
			deviceId: revoked.deviceId,
			status: revoked.status,
			revokedAt: revoked.revokedAt,
			requeuedJobs: revoked.requeuedJobs
		});
	}

	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	if (!serviceRoleKey) return respond(503, { code: 'desktop_ocr_not_configured' });

	const generated = await generateDesktopWorkerCredential();
	const admin = createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data, error } = await admin.rpc('register_ocr_worker_device', {
		target_user_id: user.id,
		device_label: input.label,
		digest_hex: generated.digestHex,
		device_capabilities: input.capabilities
	});
	if (error) return respond(503, { code: 'desktop_ocr_pair_failed' });
	const device = parseRegisteredDevice(data);
	if (!device || device.label !== input.label) {
		return respond(503, { code: 'desktop_ocr_pair_failed' });
	}

	return respond(201, {
		deviceId: device.deviceId,
		label: device.label,
		status: device.status,
		capabilities: device.capabilities,
		createdAt: device.createdAt,
		credential: generated.credential
	});
});
