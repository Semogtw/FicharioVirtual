import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { refreshGoogleAccessToken } from '../_shared/google-oauth-http.ts';

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

	if (!appOrigin) return respond(503, { code: 'drive_oauth_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) {
		return respond(401, { code: 'authentication_required' });
	}

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
	const refreshToken = data;

	try {
		const refreshed = await refreshGoogleAccessToken({ clientId, clientSecret, refreshToken });
		const expiresAt = new Date(
			Date.now() + Math.max(1, refreshed.expiresIn - 30) * 1000
		).toISOString();
		return respond(200, { accessToken: refreshed.accessToken, expiresAt });
	} catch {
		return respond(503, { code: 'drive_token_refresh_failed' });
	}
});
