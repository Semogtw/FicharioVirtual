import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { refreshGoogleAccessToken } from '../_shared/google-oauth-http.ts';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const MAX_RANGE_BYTES = 1024 * 1024;
const RETRY_DELAYS_MS = [250, 750, 1500] as const;

type MediaRequest =
	| Readonly<{ operation: 'metadata'; fileId: string }>
	| Readonly<{ operation: 'download'; fileId: string; maximumBytes: number }>
	| Readonly<{
			operation: 'read';
			fileId: string;
			start: number;
			endExclusive: number;
			totalBytes: number;
	  }>;

type DriveMetadata = Readonly<{ size: number; mimeType: string }>;

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

function media(bytes: Uint8Array, appOrigin: string | null) {
	const body = Uint8Array.from(bytes).buffer;
	return new Response(body, {
		status: 200,
		headers: {
			...corsHeaders(appOrigin),
			'Content-Type': 'application/octet-stream',
			'Content-Length': String(bytes.byteLength),
			'Cache-Control': 'no-store'
		}
	});
}

function streamedMedia(
	response: Response,
	metadata: DriveMetadata,
	appOrigin: string | null
): Response {
	return new Response(response.body, {
		status: 200,
		headers: {
			...corsHeaders(appOrigin),
			'Access-Control-Expose-Headers': 'X-Drive-Media-Type',
			'Content-Type': 'application/octet-stream',
			'Content-Length': String(metadata.size),
			'X-Drive-Media-Type': metadata.mimeType,
			'Cache-Control': 'private, no-store'
		}
	});
}

function safeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value);
}

function parseBody(value: unknown): MediaRequest | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	if (typeof body.fileId !== 'string' || !DRIVE_ID.test(body.fileId)) return null;
	if (body.operation === 'metadata') {
		if (!Object.keys(body).every((key) => key === 'operation' || key === 'fileId')) return null;
		return Object.freeze({ operation: 'metadata', fileId: body.fileId });
	}
	if (body.operation === 'download') {
		if (
			!Object.keys(body).every((key) => ['operation', 'fileId', 'maximumBytes'].includes(key)) ||
			!safeInteger(body.maximumBytes) ||
			body.maximumBytes < 1 ||
			body.maximumBytes > MAX_MEDIA_BYTES
		) {
			return null;
		}
		return Object.freeze({
			operation: 'download',
			fileId: body.fileId,
			maximumBytes: body.maximumBytes
		});
	}
	if (body.operation !== 'read') return null;
	if (
		!Object.keys(body).every((key) =>
			['operation', 'fileId', 'start', 'endExclusive', 'totalBytes'].includes(key)
		) ||
		!safeInteger(body.start) ||
		!safeInteger(body.endExclusive) ||
		!safeInteger(body.totalBytes) ||
		body.start < 0 ||
		body.endExclusive <= body.start ||
		body.totalBytes < 1 ||
		body.totalBytes > MAX_MEDIA_BYTES ||
		body.endExclusive > body.totalBytes ||
		body.endExclusive - body.start > MAX_RANGE_BYTES
	) {
		return null;
	}
	return Object.freeze({
		operation: 'read',
		fileId: body.fileId,
		start: body.start,
		endExclusive: body.endExclusive,
		totalBytes: body.totalBytes
	});
}

async function requestJson(request: Request): Promise<unknown> {
	const length = Number(request.headers.get('Content-Length') ?? '0');
	if (Number.isFinite(length) && length > 4096) throw new Error('request too large');
	return await request.json();
}

function retryable(status: number) {
	return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function googleFetch(url: string, init: RequestInit): Promise<Response> {
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
		try {
			const response = await fetch(url, init);
			if (!retryable(response.status) || attempt === RETRY_DELAYS_MS.length) return response;
		} catch (error) {
			if (attempt === RETRY_DELAYS_MS.length) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
	}
	throw new Error('Google Drive request exhausted');
}

async function loadDriveMetadata(base: string, accessToken: string): Promise<DriveMetadata | null> {
	const url = new URL(base);
	url.searchParams.set('fields', 'size,mimeType,trashed');
	url.searchParams.set('supportsAllDrives', 'true');
	let response: Response;
	try {
		response = await googleFetch(url.toString(), {
			headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
		});
	} catch {
		return null;
	}
	if (!response.ok) return null;
	let value: unknown;
	try {
		value = await response.json();
	} catch {
		return null;
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const size = typeof record.size === 'string' ? Number(record.size) : NaN;
	const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '';
	if (
		record.trashed === true ||
		!Number.isSafeInteger(size) ||
		size < 1 ||
		size > MAX_MEDIA_BYTES ||
		mimeType.length > 256
	) {
		return null;
	}
	return Object.freeze({ size, mimeType });
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(
		Deno.env.get('APP_ORIGIN_ALLOWLIST') ?? Deno.env.get('APP_ORIGIN'),
		request.headers.get('Origin')
	);
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);

	if (!appOrigin) return respond(503, { code: 'drive_oauth_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) {
		return respond(401, { code: 'authentication_required' });
	}

	let parsed: MediaRequest | null = null;
	try {
		parsed = parseBody(await requestJson(request));
	} catch {
		return respond(400, { code: 'invalid_request' });
	}
	if (!parsed) return respond(400, { code: 'invalid_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
	const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
	if (!supabaseUrl || !publishableKey || !serviceRoleKey || !clientId || !clientSecret) {
		return respond(503, { code: 'drive_oauth_not_configured' });
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

	const admin = createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data, error } = await admin.rpc('get_drive_refresh_token', {
		target_user_id: user.id
	});
	if (error || typeof data !== 'string' || data.length < 8) {
		return respond(409, { code: 'drive_not_connected' });
	}

	let accessToken: string;
	try {
		accessToken = (await refreshGoogleAccessToken({ clientId, clientSecret, refreshToken: data }))
			.accessToken;
	} catch {
		return respond(503, { code: 'drive_token_refresh_failed' });
	}

	const base = `https://www.googleapis.com/drive/v3/files/${parsed.fileId}`;
	if (parsed.operation === 'metadata' || parsed.operation === 'download') {
		const metadata = await loadDriveMetadata(base, accessToken);
		if (!metadata) return respond(502, { code: 'drive_media_unavailable' });
		if (parsed.operation === 'metadata') {
			return respond(200, metadata);
		}
		if (metadata.size > parsed.maximumBytes) {
			return respond(413, { code: 'drive_media_too_large_or_invalid' });
		}

		const url = new URL(base);
		url.searchParams.set('alt', 'media');
		url.searchParams.set('supportsAllDrives', 'true');
		let response: Response;
		try {
			response = await googleFetch(url.toString(), {
				headers: { Authorization: `Bearer ${accessToken}` }
			});
		} catch {
			return respond(503, { code: 'drive_media_unavailable' });
		}
		if (!response.ok || !response.body) {
			return respond(response.status === 404 ? 404 : 502, { code: 'drive_media_unavailable' });
		}
		const declaredLength = response.headers.get('Content-Length');
		if (declaredLength !== null && Number(declaredLength) !== metadata.size) {
			return respond(502, { code: 'drive_media_invalid_length' });
		}
		return streamedMedia(response, metadata, appOrigin);
	}

	const lastByte = parsed.endExclusive - 1;
	const expectedLength = parsed.endExclusive - parsed.start;
	const expectedRange = `bytes ${parsed.start}-${lastByte}/${parsed.totalBytes}`;
	const url = new URL(base);
	url.searchParams.set('alt', 'media');
	url.searchParams.set('supportsAllDrives', 'true');
	let response: Response;
	try {
		response = await googleFetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Range: `bytes=${parsed.start}-${lastByte}`
			}
		});
	} catch {
		return respond(503, { code: 'drive_media_unavailable' });
	}
	if (response.status !== 206) return respond(502, { code: 'drive_media_invalid_range' });
	const contentRange = response.headers.get('Content-Range');
	if (contentRange !== expectedRange) return respond(502, { code: 'drive_media_invalid_range' });
	const declaredLength = response.headers.get('Content-Length');
	if (declaredLength !== null && Number(declaredLength) !== expectedLength) {
		return respond(502, { code: 'drive_media_invalid_range' });
	}
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await response.arrayBuffer());
	} catch {
		return respond(502, { code: 'drive_media_unavailable' });
	}
	if (bytes.byteLength !== expectedLength)
		return respond(502, { code: 'drive_media_invalid_range' });
	return media(bytes, appOrigin);
});
