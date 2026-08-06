import { describe, expect, it, vi } from 'vitest';
import {
	beginDriveConnection,
	isDriveOAuthConfigured,
	loadDriveConnection
} from '../../../src/lib/services/drive';

const connection = {
	status: 'connected',
	google_email: 'arthur@example.test',
	root_folder_id: '0AExampleRootFolderId_123456789',
	last_sync_started_at: '2026-08-06T03:00:00.000Z',
	last_sync_completed_at: '2026-08-06T03:01:00.000Z',
	last_error_code: null,
	last_error_message: null
};

function queryClient(response: { data: unknown; error: unknown }) {
	const maybeSingle = vi.fn().mockResolvedValue(response);
	const select = vi.fn(() => ({ maybeSingle }));
	const from = vi.fn(() => ({ select }));
	return { client: { from, functions: { invoke: vi.fn() } }, from, select, maybeSingle };
}

describe('Drive service', () => {
	it('detects only a valid public OAuth client configuration', () => {
		expect(
			isDriveOAuthConfigured({
				PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_key_1234567890'
			})
		).toBe(false);
		expect(
			isDriveOAuthConfigured({
				PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_key_1234567890',
				PUBLIC_GOOGLE_CLIENT_ID: '123456789012-example.apps.googleusercontent.com'
			})
		).toBe(true);
	});

	it('loads the strict public Drive connection projection', async () => {
		const { client, from, select } = queryClient({ data: connection, error: null });

		await expect(loadDriveConnection(client)).resolves.toEqual(connection);
		expect(from).toHaveBeenCalledWith('drive_connections');
		expect(select).toHaveBeenCalledWith(
			'status,google_email,root_folder_id,last_sync_started_at,last_sync_completed_at,last_error_code,last_error_message'
		);
	});

	it('returns null when no connection exists and rejects malformed data', async () => {
		await expect(
			loadDriveConnection(queryClient({ data: null, error: null }).client)
		).resolves.toBeNull();
		await expect(
			loadDriveConnection(
				queryClient({ data: { ...connection, refresh_token: 'secret' }, error: null }).client
			)
		).rejects.toThrow('Não foi possível carregar a conexão com o Google Drive.');
	});

	it('accepts only a Google HTTPS authorization URL from the Edge Function', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: {
				authorizationUrl:
					'https://accounts.google.com/o/oauth2/v2/auth?client_id=example&scope=drive.file'
			},
			error: null
		});
		const client = { from: vi.fn(), functions: { invoke } };

		await expect(beginDriveConnection(client)).resolves.toBe(
			'https://accounts.google.com/o/oauth2/v2/auth?client_id=example&scope=drive.file'
		);
		expect(invoke).toHaveBeenCalledWith('drive-oauth-start', { body: {} });

		invoke.mockResolvedValueOnce({
			data: { authorizationUrl: 'https://evil.example/steal' },
			error: null
		});
		await expect(beginDriveConnection(client)).rejects.toThrow(
			'Não foi possível iniciar a conexão com o Google Drive.'
		);
	});
});
