import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseAppOrigin } from '../_shared/cors.ts';
import { bootstrapDriveRoot } from '../_shared/google-drive-client.ts';
import {
	hashOAuthState,
	requestInitialGoogleTokens,
	verifyGoogleIdToken
} from '../_shared/google-oauth-http.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE = /^[A-Za-z0-9_-]{43,128}$/;

function redirect(appOrigin: string, result: 'authorized' | 'cancelled' | 'error') {
	const location = new URL('/settings/', appOrigin);
	location.searchParams.set('drive', result);
	return new Response(null, {
		status: 303,
		headers: {
			Location: location.toString(),
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer'
		}
	});
}

function consumedState(value: unknown): { userId: string; nonce: string } | null {
	if (!Array.isArray(value) || value.length !== 1) return null;
	const row = value[0];
	if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
	const record = row as Record<string, unknown>;
	if (
		Object.keys(record).length !== 2 ||
		typeof record.user_id !== 'string' ||
		!UUID.test(record.user_id) ||
		typeof record.nonce !== 'string' ||
		!OPAQUE.test(record.nonce)
	) {
		return null;
	}
	return { userId: record.user_id, nonce: record.nonce };
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	if (!appOrigin) return new Response('Drive OAuth is not configured.', { status: 503 });
	if (request.method !== 'GET') return redirect(appOrigin, 'error');

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
	const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
	const redirectUri = Deno.env.get('GOOGLE_DRIVE_REDIRECT_URI');
	const rootFolderName = Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_NAME');
	if (
		!supabaseUrl ||
		!serviceRoleKey ||
		!clientId ||
		!clientSecret ||
		!redirectUri ||
		!rootFolderName
	) {
		return redirect(appOrigin, 'error');
	}

	const url = new URL(request.url);
	const state = url.searchParams.get('state');
	if (!state || !OPAQUE.test(state)) return redirect(appOrigin, 'error');

	try {
		const admin = createClient(supabaseUrl, serviceRoleKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
		const stateHash = await hashOAuthState(state);
		const { data: consumed, error: consumeError } = await admin.rpc('consume_drive_oauth_state', {
			target_state_hash: stateHash,
			consumed_at: new Date().toISOString()
		});
		const verifiedState = consumeError ? null : consumedState(consumed);
		if (!verifiedState) return redirect(appOrigin, 'error');

		if (url.searchParams.has('error')) return redirect(appOrigin, 'cancelled');
		const code = url.searchParams.get('code');
		if (!code) return redirect(appOrigin, 'error');

		const tokens = await requestInitialGoogleTokens({
			clientId,
			clientSecret,
			redirectUri,
			code
		});
		if (!tokens.refreshToken || !tokens.idToken) return redirect(appOrigin, 'error');
		const identity = await verifyGoogleIdToken({
			idToken: tokens.idToken,
			clientId,
			nonce: verifiedState.nonce,
			nowSeconds: Math.floor(Date.now() / 1000)
		});

		const { data: stored, error: storeError } = await admin.rpc('store_drive_credential', {
			target_user_id: verifiedState.userId,
			target_refresh_token: tokens.refreshToken,
			target_google_subject: identity.subject,
			target_google_email: identity.email,
			target_scope: tokens.scopes.join(' ')
		});
		if (storeError || stored !== true) return redirect(appOrigin, 'error');

		const bootstrap = await bootstrapDriveRoot({
			accessToken: tokens.accessToken,
			rootFolderName
		});
		const { data: completed, error: completeError } = await admin.rpc('complete_drive_connection', {
			target_user_id: verifiedState.userId,
			target_root_folder_id: bootstrap.rootFolder.id,
			target_start_page_token: bootstrap.startPageToken
		});
		if (completeError || completed !== true) return redirect(appOrigin, 'error');
		return redirect(appOrigin, 'authorized');
	} catch {
		return redirect(appOrigin, 'error');
	}
});
