import { env } from '$env/dynamic/public';
import { z } from 'zod';
import { parseDriveConnection, type DriveConnection } from '$lib/drive/connection-state';
import { getSupabaseClient } from './supabase';

const CONNECTION_COLUMNS =
	'status,google_email,root_folder_id,last_sync_started_at,last_sync_completed_at,last_error_code,last_error_message';
const GOOGLE_CLIENT_ID = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

export type DriveServiceClientLike = {
	from(name: 'drive_connections'): {
		select(columns: typeof CONNECTION_COLUMNS): {
			maybeSingle(): Promise<{ data: unknown; error: unknown }>;
		};
	};
	functions: {
		invoke(
			name: 'drive-oauth-start' | 'drive-sync',
			options: { body: Record<string, never> }
		): Promise<{ data: unknown; error: unknown }>;
	};
};

export type DriveSyncClientLike = Pick<DriveServiceClientLike, 'functions'>;

export interface DriveSyncReceipt {
	status: 'completed' | 'partial';
	pages: number;
	applied: number;
	ignored: number;
	conflicts: number;
}

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
	const clientId = source.PUBLIC_GOOGLE_CLIENT_ID?.trim();
	return clientId !== undefined && GOOGLE_CLIENT_ID.test(clientId);
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

const syncReceiptSchema = z
	.object({
		status: z.enum(['completed', 'partial']),
		pages: z.int().min(1).max(100),
		applied: z.int().min(0).max(1_000_000),
		ignored: z.int().min(0).max(1_000_000),
		conflicts: z.int().min(0).max(1_000_000)
	})
	.strict();

export async function synchronizeDriveConnection(
	client: DriveSyncClientLike = defaultClient()
): Promise<Readonly<DriveSyncReceipt>> {
	try {
		const { data, error } = await client.functions.invoke('drive-sync', { body: {} });
		if (error) throw error;
		return Object.freeze(syncReceiptSchema.parse(data));
	} catch {
		throw new DriveConnectionServiceError('Não foi possível sincronizar o Google Drive.');
	}
}
