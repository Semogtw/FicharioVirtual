import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import {
	executeDriveJob,
	parseClaimedDriveJob,
	type ClaimedDriveJob,
	type DriveJobDocument,
	type DriveJobGateway,
	type DriveJobNotebook
} from '../_shared/drive-job-runner.ts';
import { ensureDriveFolder } from '../_shared/google-drive-client.ts';
import {
	deleteGoogleDriveItem,
	getGoogleDriveItem,
	updateGoogleDriveItem,
	type GoogleDriveItem
} from '../_shared/google-drive-mutations.ts';
import { refreshGoogleAccessToken } from '../_shared/google-oauth-http.ts';

const MAX_JOBS_PER_INVOCATION = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function record(value: unknown): Record<string, unknown> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const keys = Object.keys(value).sort();
	const expected = [...allowed].sort();
	return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function parseNotebook(value: unknown): DriveJobNotebook {
	const row = record(value);
	if (
		!row ||
		!exactKeys(row, ['id', 'name', 'parent_notebook_id', 'drive_folder_id']) ||
		typeof row.id !== 'string' ||
		!UUID.test(row.id) ||
		typeof row.name !== 'string' ||
		row.name.trim().length < 1 ||
		row.name.trim().length > 160 ||
		(row.parent_notebook_id !== null &&
			(typeof row.parent_notebook_id !== 'string' || !UUID.test(row.parent_notebook_id))) ||
		(row.drive_folder_id !== null &&
			(typeof row.drive_folder_id !== 'string' || !DRIVE_ID.test(row.drive_folder_id)))
	) {
		throw new TypeError('Invalid Drive notebook worker response');
	}
	return Object.freeze({
		id: row.id,
		name: row.name.trim(),
		parentNotebookId: row.parent_notebook_id as string | null,
		driveFolderId: row.drive_folder_id as string | null
	});
}

function parseDocument(value: unknown): DriveJobDocument {
	const row = record(value);
	if (
		!row ||
		!exactKeys(row, [
			'id',
			'kind',
			'notebook_id',
			'drive_file_id',
			'drive_parent_folder_id',
			'drive_mime_type'
		]) ||
		typeof row.id !== 'string' ||
		!UUID.test(row.id) ||
		(row.kind !== 'image' && row.kind !== 'pdf') ||
		(row.notebook_id !== null &&
			(typeof row.notebook_id !== 'string' || !UUID.test(row.notebook_id))) ||
		typeof row.drive_file_id !== 'string' ||
		!DRIVE_ID.test(row.drive_file_id) ||
		typeof row.drive_parent_folder_id !== 'string' ||
		!DRIVE_ID.test(row.drive_parent_folder_id) ||
		typeof row.drive_mime_type !== 'string' ||
		row.drive_mime_type.length < 1 ||
		row.drive_mime_type.length > 256
	) {
		throw new TypeError('Invalid Drive document worker response');
	}
	return Object.freeze({
		id: row.id,
		kind: row.kind,
		notebookId: row.notebook_id as string | null,
		driveFileId: row.drive_file_id,
		driveParentFolderId: row.drive_parent_folder_id,
		driveMimeType: row.drive_mime_type
	});
}

function parseClaim(value: unknown): ClaimedDriveJob | null {
	if (!Array.isArray(value)) throw new TypeError('Invalid Drive claim response');
	if (value.length === 0) return null;
	if (value.length !== 1) throw new TypeError('Invalid Drive claim response');
	return parseClaimedDriveJob(value[0]);
}

function toDriveItem(folder: Awaited<ReturnType<typeof ensureDriveFolder>>): GoogleDriveItem {
	return Object.freeze({
		id: folder.id,
		name: folder.name,
		mimeType: folder.mimeType,
		parents: Object.freeze([...folder.parents]),
		modifiedTime: folder.modifiedTime,
		version: folder.version,
		md5Checksum: folder.md5Checksum ?? null,
		trashed: folder.trashed
	});
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(
		Deno.env.get('APP_ORIGIN_ALLOWLIST') ?? Deno.env.get('APP_ORIGIN'),
		request.headers.get('Origin')
	);
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
	const { data: privateToken, error: privateTokenError } = await admin.rpc(
		'get_drive_refresh_token',
		{ target_user_id: user.id }
	);
	if (privateTokenError || typeof privateToken !== 'string' || privateToken.length < 8) {
		return respond(409, { code: 'drive_not_connected' });
	}
	const refreshToken = privateToken;

	let accessToken: string;
	try {
		const refreshed = await refreshGoogleAccessToken({ clientId, clientSecret, refreshToken });
		accessToken = refreshed.accessToken;
	} catch {
		return respond(503, { code: 'drive_token_refresh_failed' });
	}

	const workerId = `edge:${crypto.randomUUID()}`;
	let processed = 0;
	let synced = 0;
	let retryable = 0;
	let conflicts = 0;
	let exhausted = false;

	const gateway: DriveJobGateway = {
		async loadNotebook(notebookId) {
			const { data, error } = await admin
				.from('notebooks')
				.select('id,name,parent_notebook_id,drive_folder_id')
				.eq('id', notebookId)
				.eq('user_id', user.id)
				.maybeSingle();
			if (error || !data) throw new Error('Drive notebook unavailable');
			return parseNotebook(data);
		},
		async loadDocument(documentId) {
			const { data, error } = await admin
				.from('documents')
				.select('id,kind,notebook_id,drive_file_id,drive_parent_folder_id,drive_mime_type')
				.eq('id', documentId)
				.eq('user_id', user.id)
				.maybeSingle();
			if (error || !data) throw new Error('Drive document unavailable');
			return parseDocument(data);
		},
		async resolveFolder(notebookId) {
			if (notebookId === null) {
				const { data, error } = await admin
					.from('drive_connections')
					.select('root_folder_id')
					.eq('user_id', user.id)
					.maybeSingle();
				if (
					error ||
					!data ||
					typeof data.root_folder_id !== 'string' ||
					!DRIVE_ID.test(data.root_folder_id)
				) {
					throw new Error('Drive root unavailable');
				}
				return data.root_folder_id;
			}
			const notebook = await this.loadNotebook(notebookId);
			if (notebook.driveFolderId === null) throw new Error('Drive parent pending');
			return notebook.driveFolderId;
		},
		async ensureFolder(name, parentFolderId) {
			return toDriveItem(await ensureDriveFolder({ accessToken, name, parentId: parentFolderId }));
		},
		getItem(fileId) {
			return getGoogleDriveItem({ accessToken, fileId });
		},
		updateItem(input) {
			return updateGoogleDriveItem({ accessToken, ...input });
		},
		deleteItem(fileId) {
			return deleteGoogleDriveItem({ accessToken, fileId });
		},
		async complete(job, item, parentFolderId) {
			const { data, error } = await admin.rpc('complete_drive_sync_job', {
				target_user_id: user.id,
				target_job_id: job.id,
				worker_id: workerId,
				target_drive_file_id: item?.id ?? null,
				target_drive_parent_folder_id: parentFolderId,
				target_drive_modified_time: item?.modifiedTime ?? null,
				target_drive_version: item?.version ?? null,
				target_drive_md5_checksum: item?.md5Checksum ?? null
			});
			if (error || data !== true) throw new Error('Drive completion rejected');
		},
		async retry(job, code, message) {
			const { data, error } = await admin.rpc('retry_drive_sync_job', {
				target_user_id: user.id,
				target_job_id: job.id,
				worker_id: workerId,
				target_error_code: code,
				target_error_message: message
			});
			if (error || data !== true) throw new Error('Drive retry rejected');
		},
		async conflict(job, kind, localSnapshot, remoteSnapshot) {
			const { data, error } = await admin.rpc('conflict_drive_sync_job', {
				target_user_id: user.id,
				target_job_id: job.id,
				worker_id: workerId,
				target_kind: kind,
				target_local_snapshot: localSnapshot,
				target_remote_snapshot: remoteSnapshot
			});
			if (error || data !== true) throw new Error('Drive conflict rejected');
		}
	};

	try {
		while (processed < MAX_JOBS_PER_INVOCATION) {
			const { data, error } = await admin.rpc('claim_drive_sync_job_for_user', {
				target_user_id: user.id,
				worker_id: workerId,
				lease_seconds: 120
			});
			if (error) throw new Error('Drive claim failed');
			const job = parseClaim(data);
			if (job === null) break;
			const outcome = await executeDriveJob(job, gateway);
			processed += 1;
			if (outcome === 'synced') synced += 1;
			else if (outcome === 'retryable') retryable += 1;
			else conflicts += 1;
		}
		exhausted = processed === MAX_JOBS_PER_INVOCATION;
		return respond(exhausted ? 202 : 200, {
			status: exhausted ? 'partial' : 'completed',
			processed,
			synced,
			retryable,
			conflicts
		});
	} catch {
		return respond(503, { code: 'drive_job_runner_failed' });
	}
});
