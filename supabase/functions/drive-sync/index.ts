import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { listGoogleDriveChanges, type GoogleDriveChange } from '../_shared/google-drive-changes.ts';
import { refreshGoogleAccessToken } from '../_shared/google-oauth-http.ts';

const MAX_PAGES_PER_INVOCATION = 100;
const PAGE_TOKEN = /^.{1,4096}$/s;

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

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function remoteEventKey(pageToken: string, change: GoogleDriveChange): Promise<string> {
	const marker = change.removed
		? 'removed'
		: `${change.file.version}:${change.file.modifiedTime}:${change.file.trashed}`;
	const payload = new TextEncoder().encode(`${pageToken}\u0000${change.fileId}\u0000${marker}`);
	const digest = await crypto.subtle.digest('SHA-256', payload);
	return `remote:${base64Url(new Uint8Array(digest))}`;
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);
	if (!appOrigin) return respond(503, { code: 'drive_not_configured' });
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
		return respond(503, { code: 'drive_not_configured' });
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

	try {
		const { data: refreshToken, error: refreshError } = await admin.rpc(
			'get_drive_refresh_token',
			{ target_user_id: user.id }
		);
		if (refreshError || typeof refreshToken !== 'string' || refreshToken.length < 8) {
			return respond(409, { code: 'drive_not_connected' });
		}

		const refreshed = await refreshGoogleAccessToken({ clientId, clientSecret, refreshToken });
		const accessToken = refreshed.accessToken;
		const { data: initialToken, error: beginError } = await admin.rpc(
			'begin_drive_remote_sync',
			{ target_user_id: user.id }
		);
		if (beginError || typeof initialToken !== 'string' || !PAGE_TOKEN.test(initialToken)) {
			return respond(409, { code: 'drive_not_connected' });
		}

		let pageToken = initialToken;
		let pages = 0;
		let applied = 0;
		let ignored = 0;
		let conflicts = 0;

		while (pages < MAX_PAGES_PER_INVOCATION) {
			const page = await listGoogleDriveChanges({ accessToken, pageToken });
			for (const change of page.changes) {
				const eventKey = await remoteEventKey(pageToken, change);
				const file = change.removed ? null : change.file;
				const parentFolderId = file?.parents.length === 1 ? file.parents[0] : null;
				const { data: outcome, error: applyError } = await admin.rpc(
					'apply_drive_remote_change',
					{
						target_user_id: user.id,
						target_event_key: eventKey,
						target_file_id: change.fileId,
						target_removed: change.removed,
						target_file_name: file?.name ?? null,
						target_mime_type: file?.mimeType ?? null,
						target_parent_folder_id: parentFolderId,
						target_modified_time: file?.modifiedTime ?? null,
						target_version: file?.version ?? null,
						target_md5_checksum: file?.md5Checksum ?? null,
						target_trashed: file?.trashed ?? false
					}
				);
				if (applyError || !['applied', 'ignored', 'conflict'].includes(outcome)) {
					throw new Error('Drive remote change persistence failed');
				}
				if (outcome === 'applied') applied += 1;
				else if (outcome === 'ignored') ignored += 1;
				else conflicts += 1;
			}

			const checkpoint = page.nextPageToken ?? page.newStartPageToken;
			if (checkpoint === null) throw new Error('Drive change checkpoint missing');
			const completed = page.nextPageToken === null;
			const { data: checkpointed, error: checkpointError } = await admin.rpc(
				'persist_drive_change_checkpoint',
				{
					target_user_id: user.id,
					expected_page_token: pageToken,
					target_page_token: checkpoint,
					completed
				}
			);
			if (checkpointError || checkpointed !== true) {
				throw new Error('Drive change checkpoint conflict');
			}

			pages += 1;
			if (completed) {
				return respond(200, {
					status: 'completed',
					pages,
					applied,
					ignored,
					conflicts
				});
			}
			pageToken = checkpoint;
		}

		return respond(202, {
			status: 'partial',
			pages,
			applied,
			ignored,
			conflicts
		});
	} catch {
		await admin.rpc('fail_drive_remote_sync', {
			target_user_id: user.id,
			target_error_code: 'drive_sync_failed',
			target_error_message: 'A sincronização do Google Drive falhou e poderá ser retomada.'
		});
		return respond(503, { code: 'drive_sync_failed' });
	}
});
