import { createClient } from 'npm:@supabase/supabase-js@2';
import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';

const PAIRING_CODE = /^[0-9A-Fa-f]{4}(-[0-9A-Fa-f]{4}){3}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_CAPABILITIES_BYTES = 12 * 1024;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

type RedeemRequest = Readonly<{
	action: 'redeem';
	pairingCode: string;
	label: string;
	capabilities: Readonly<Record<string, unknown>>;
	credentialDigest: string;
}>;

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

function parseRedeemRequest(value: unknown): RedeemRequest | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
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

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(
		Deno.env.get('APP_ORIGIN_ALLOWLIST') ?? Deno.env.get('APP_ORIGIN'),
		request.headers.get('Origin')
	);
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
	const input = parseRedeemRequest(rawBody);
	if (!input) return respond(400, { code: 'invalid_pair_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	if (!supabaseUrl || !serviceRoleKey) {
		return respond(503, { code: 'desktop_ocr_not_configured' });
	}

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
});
