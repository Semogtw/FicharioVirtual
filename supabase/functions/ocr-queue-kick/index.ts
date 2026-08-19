import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';

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

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(
		Deno.env.get('APP_ORIGIN_ALLOWLIST') ?? Deno.env.get('APP_ORIGIN'),
		request.headers.get('Origin')
	);
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);
	if (!appOrigin) return respond(503, { code: 'ocr_background_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) {
		return respond(401, { code: 'authentication_required' });
	}

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	const workerKey = Deno.env.get('OCR_BACKGROUND_WORKER_KEY');
	if (!supabaseUrl || !publishableKey || !workerKey) {
		return respond(503, { code: 'ocr_background_not_configured' });
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
	if (allowedError || !allowed) return respond(403, { code: 'not_authorized' });

	try {
		const workerResponse = await fetch(`${supabaseUrl}/functions/v1/ocr-queue-worker`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Fichario-Worker-Key': workerKey,
				'X-Fichario-Worker-Mode': 'sync'
			},
			body: JSON.stringify({ source: 'authenticated-kick', userId: user.id })
		});
		if (!workerResponse.ok) return respond(503, { code: 'ocr_worker_unavailable' });
		let receipt: unknown;
		try {
			receipt = await workerResponse.json();
		} catch {
			return respond(503, { code: 'ocr_worker_unavailable' });
		}
		if (
			receipt === null ||
			typeof receipt !== 'object' ||
			Array.isArray(receipt) ||
			(receipt as Record<string, unknown>).completed !== true ||
			typeof (receipt as Record<string, unknown>).hasMore !== 'boolean'
		) {
			return respond(503, { code: 'ocr_worker_unavailable' });
		}
		return respond(202, {
			accepted: true,
			hasMore: (receipt as Record<string, unknown>).hasMore
		});
	} catch {
		return respond(503, { code: 'ocr_worker_unavailable' });
	}
});
