import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import {
	buildNotebookFolderChain,
	parseDriveNotebookRows
} from '../_shared/drive-folder-chain.ts';
import { ensureDriveFolder } from '../_shared/google-drive-client.ts';
import { refreshGoogleAccessToken } from '../_shared/google-oauth-http.ts';

const inputSchema = z
	.object({
		notebookId: z.uuid().nullable()
	})
	.strict();
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;

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
	if (!appOrigin) return respond(503, { code: 'drive_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) {
		return respond(401, { code: 'authentication_required' });
	}
	let input: z.infer<typeof inputSchema>;
	try {
		input = inputSchema.parse(await request.json());
	} catch {
		return respond(400, { code: 'invalid_drive_folder_request' });
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
	const { data: allowed, error: allowedError } = await admin
		.from('app_users')
		.select('user_id')
		.eq('user_id', user.id)
		.eq('is_active', true)
		.maybeSingle();
	if (allowedError || !allowed) return respond(403, { code: 'drive_forbidden' });

	const { data: connection, error: connectionError } = await admin
		.from('drive_connections')
		.select('status,root_folder_id')
		.eq('user_id', user.id)
		.maybeSingle();
	if (
		connectionError ||
		!connection ||
		!['connected', 'syncing'].includes(connection.status) ||
		typeof connection.root_folder_id !== 'string' ||
		!DRIVE_ID.test(connection.root_folder_id)
	) {
		return respond(409, { code: 'drive_not_connected' });
	}
	if (input.notebookId === null) return respond(200, { folderId: connection.root_folder_id });

	const { data: notebookData, error: notebookError } = await admin
		.from('notebooks')
		.select('id,name,parent_notebook_id,drive_folder_id,drive_missing')
		.eq('user_id', user.id);
	if (notebookError) return respond(503, { code: 'drive_folder_lookup_failed' });

	let chain;
	try {
		chain = buildNotebookFolderChain(parseDriveNotebookRows(notebookData), input.notebookId);
	} catch {
		return respond(409, { code: 'invalid_notebook_hierarchy' });
	}

	let parentFolderId = connection.root_folder_id;
	let accessToken: string | null = null;
	for (const notebook of chain) {
		if (notebook.driveFolderId !== null && !notebook.driveMissing) {
			parentFolderId = notebook.driveFolderId;
			continue;
		}
		if (accessToken === null) {
			const { data: refreshToken, error: refreshError } = await admin.rpc(
				'get_drive_refresh_token',
				{ target_user_id: user.id }
			);
			if (refreshError || typeof refreshToken !== 'string' || refreshToken.length < 8) {
				return respond(409, { code: 'drive_not_connected' });
			}
			try {
				const refreshed = await refreshGoogleAccessToken({
					clientId,
					clientSecret,
					refreshToken
				});
				accessToken = refreshed.accessToken;
			} catch {
				return respond(503, { code: 'drive_token_refresh_failed' });
			}
		}

		try {
			const folder = await ensureDriveFolder({
				accessToken,
				name: notebook.name,
				parentId: parentFolderId
			});
			const { error: updateError } = await admin
				.from('notebooks')
				.update({
					drive_folder_id: folder.id,
					drive_modified_time: folder.modifiedTime,
					drive_version: folder.version,
					drive_sync_status: 'synced',
					drive_missing: false
				})
				.eq('id', notebook.id)
				.eq('user_id', user.id);
			if (updateError) return respond(503, { code: 'drive_folder_persist_failed' });
			parentFolderId = folder.id;
		} catch {
			return respond(503, { code: 'drive_folder_create_failed' });
		}
	}

	return respond(200, { folderId: parentFolderId });
});
