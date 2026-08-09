import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { generateDesktopWorkerCredential } from '../_shared/desktop-worker-auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CAPABILITIES_BYTES = 12 * 1024;

type PairRequest = Readonly<{
	label: string;
	capabilities: Readonly<Record<string, unknown>>;
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

function parsePairRequest(value: unknown): PairRequest | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (!hasExactKeys(record, ['label', 'capabilities'])) return null;
	if (typeof record.label !== 'string' || record.label !== record.label.trim()) return null;
	if (
		record.label.length < 1 ||
		record.label.length > 80 ||
		// eslint-disable-next-line no-control-regex -- reject ASCII controls from a device label
		/[\u0000-\u001f\u007f]/.test(record.label)
	) {
		return null;
	}
	if (
		record.capabilities === null ||
		typeof record.capabilities !== 'object' ||
		Array.isArray(record.capabilities)
	) {
		return null;
	}
	let serialized: string;
	try {
		serialized = JSON.stringify(record.capabilities);
	} catch {
		return null;
	}
	if (new TextEncoder().encode(serialized).byteLength > MAX_CAPABILITIES_BYTES) return null;
	return Object.freeze({
		label: record.label,
		capabilities: Object.freeze({ ...(record.capabilities as Record<string, unknown>) })
	});
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

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);

	if (!appOrigin) return respond(503, { code: 'desktop_ocr_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) {
		return respond(401, { code: 'authentication_required' });
	}

	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return respond(400, { code: 'invalid_json' });
	}
	const input = parsePairRequest(rawBody);
	if (!input) return respond(400, { code: 'invalid_pair_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
		return respond(503, { code: 'desktop_ocr_not_configured' });
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
