import { env } from '$env/dynamic/public';
import { z } from 'zod';
import { parseDriveConnection, type DriveConnection } from '$lib/drive/connection-state';
import { parsePublicEnv } from '$lib/env/public';
import { getSupabaseClient } from './supabase';

const CONNECTION_COLUMNS =
	'status,google_email,root_folder_id,last_sync_started_at,last_sync_completed_at,last_error_code,last_error_message';

export type DriveServiceClientLike = {
	from(name: 'drive_connections'): {
		select(columns: typeof CONNECTION_COLUMNS): {
			maybeSingle(): Promise<{ data: unknown; error: unknown }>;
		};
	};
	functions: {
		invoke(
			name: 'drive-oauth-start',
			options: { body: Record<string, never> }
		): Promise<{ data: unknown; error: unknown }>;
	};
};

export class DriveConnectionServiceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DriveConnectionServiceError';
	}
}

function defaultClient(): DriveServiceClientLike {
	return getSupabaseClient() as unknown as DriveServiceClientLike;
}

export function isDriveOAuthConfigured(source: Record<string, string | undefined> = env): boolean {
	return parsePublicEnv(source).PUBLIC_GOOGLE_CLIENT_ID !== null;
}

export async function loadDriveConnection(
	client: DriveServiceClientLike = defaultClient()
): Promise<DriveConnection | null> {
	try {
		const { data, error } = await client
			.from('drive_connections')
			.select(CONNECTION_COLUMNS)
			.maybeSingle();
		if (error) throw error;
		if (data === null) return null;
		return parseDriveConnection(data);
	} catch {
		throw new DriveConnectionServiceError(
			'Não foi possível carregar a conexão com o Google Drive.'
		);
	}
}

const oauthStartSchema = z
	.object({
		authorizationUrl: z.url()
	})
	.strict();

export async function beginDriveConnection(
	client: DriveServiceClientLike = defaultClient()
): Promise<string> {
	try {
		const { data, error } = await client.functions.invoke('drive-oauth-start', { body: {} });
		if (error) throw error;
		const parsed = oauthStartSchema.parse(data);
		const url = new URL(parsed.authorizationUrl);
		if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') {
			throw new TypeError('Invalid Google authorization URL');
		}
		return url.toString();
	} catch {
		throw new DriveConnectionServiceError('Não foi possível iniciar a conexão com o Google Drive.');
	}
}
