import { describe, expect, it } from 'vitest';
import {
	driveConnectionPresentation,
	parseDriveConnection
} from '../../../src/lib/drive/connection-state';

const connection = {
	status: 'connected',
	google_email: 'arthur@example.test',
	root_folder_id: '0AExampleRootFolderId_123456789',
	last_sync_started_at: '2026-08-06T03:00:00.000Z',
	last_sync_completed_at: '2026-08-06T03:01:00.000Z',
	last_error_code: null,
	last_error_message: null
};

describe('Drive connection state', () => {
	it('parses and freezes the public connection projection', () => {
		const result = parseDriveConnection(connection);

		expect(result).toEqual(connection);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it('rejects secrets and malformed connection responses', () => {
		expect(() => parseDriveConnection({ ...connection, refresh_token: 'secret' })).toThrow(
			'Invalid Drive connection response'
		);
		expect(() => parseDriveConnection({ ...connection, root_folder_id: 'bad id' })).toThrow(
			'Invalid Drive connection response'
		);
		expect(() => parseDriveConnection({ ...connection, status: 'unknown' })).toThrow(
			'Invalid Drive connection response'
		);
	});

	it('keeps configuration errors user-friendly and separate from a disconnected account', () => {
		expect(driveConnectionPresentation({ configured: false, connection: null })).toEqual({
			kind: 'configuration_required',
			title: 'Indisponível',
			detail: 'O Google Drive está temporariamente indisponível. Tente novamente mais tarde.',
			canConnect: false,
			canSynchronize: false
		});
		expect(driveConnectionPresentation({ configured: true, connection: null })).toEqual({
			kind: 'disconnected',
			title: 'Não conectado',
			detail: 'Conecte sua conta para guardar e sincronizar seus arquivos.',
			canConnect: true,
			canSynchronize: false
		});
	});

	it('presents connected and syncing states without implementation details', () => {
		expect(
			driveConnectionPresentation({
				configured: true,
				connection: parseDriveConnection(connection)
			})
		).toEqual({
			kind: 'connected',
			title: 'Conectado',
			detail: 'arthur@example.test está conectado ao Fichário.',
			canConnect: false,
			canSynchronize: true
		});

		expect(
			driveConnectionPresentation({
				configured: true,
				connection: parseDriveConnection({ ...connection, status: 'syncing' })
			})
		).toMatchObject({
			kind: 'syncing',
			title: 'Sincronizando…',
			canConnect: false,
			canSynchronize: false
		});
	});
});
