import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { buildGoogleAuthorizationUrl } from '../_shared/google-oauth.ts';
import {
	generateOAuthOpaqueValue,
	hashOAuthState
} from '../_shared/google-oauth-http.ts';

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
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
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
	const redirectUri = Deno.env.get('GOOGLE_DRIVE_REDIRECT_URI');
	if (!supabaseUrl || !publishableKey || !serviceRoleKey || !clientId || !redirectUri) {
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

	const { data: allowed, error: allowedError } = await userClient
		.from('app_users')
		.select('is_active')
		.eq('user_id', user.id)
		.eq('is_active', true)
		.maybeSingle();
	if (allowedError || !allowed) return respond(403, { code: 'drive_oauth_forbidden' });

	const state = generateOAuthOpaqueValue();
	const nonce = generateOAuthOpaqueValue();
	const stateHash = await hashOAuthState(state);
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
	const admin = createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const { data: stored, error: storeError } = await admin.rpc('store_drive_oauth_state', {
		target_user_id: user.id,
		target_state_hash: stateHash,
		target_nonce: nonce,
		target_expires_at: expiresAt
	});
	if (storeError || stored !== true) {
		return respond(503, { code: 'drive_oauth_state_failed' });
	}

	let authorizationUrl: string;
	try {
		authorizationUrl = buildGoogleAuthorizationUrl({ clientId, redirectUri, state, nonce });
	} catch {
		return respond(503, { code: 'drive_oauth_not_configured' });
	}
	return respond(200, { authorizationUrl });
});
