import { z } from 'zod';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';

export type DriveConnectionStatus =
	'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error' | 'revoked';

export interface DriveConnection {
	status: DriveConnectionStatus;
	google_email: string | null;
	root_folder_id: string | null;
	last_sync_started_at: string | null;
	last_sync_completed_at: string | null;
	last_error_code: string | null;
	last_error_message: string | null;
}

export type DriveConnectionPresentationKind =
	| 'configuration_required'
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'syncing'
	| 'error'
	| 'revoked';

export interface DriveConnectionPresentation {
	kind: DriveConnectionPresentationKind;
	title: string;
	detail: string;
	canConnect: boolean;
	canSynchronize: boolean;
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const connectionSchema = z
	.object({
		status: z.enum(['disconnected', 'connecting', 'connected', 'syncing', 'error', 'revoked']),
		google_email: z.email().max(320).nullable(),
		root_folder_id: z.string().regex(DRIVE_ID).nullable(),
		last_sync_started_at: z.string().refine(isIsoTimestamp).nullable(),
		last_sync_completed_at: z.string().refine(isIsoTimestamp).nullable(),
		last_error_code: z
			.string()
			.regex(/^[a-z0-9_]{1,64}$/)
			.nullable(),
		last_error_message: z.string().max(500).nullable()
	})
	.strict()
	.refine(
		(connection) =>
			!['connected', 'syncing'].includes(connection.status) ||
			(connection.google_email !== null && connection.root_folder_id !== null)
	);

export function parseDriveConnection(data: unknown): DriveConnection {
	const result = connectionSchema.safeParse(data);
	if (!result.success) throw new TypeError('Invalid Drive connection response');
	return Object.freeze(result.data);
}

function formatSyncTime(value: string | null): string | null {
	if (value === null) return null;
	return new Intl.DateTimeFormat('pt-BR', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'UTC'
	}).format(new Date(value));
}

export function driveConnectionPresentation({
	configured,
	connection
}: {
	configured: boolean;
	connection: DriveConnection | null;
}): DriveConnectionPresentation {
	if (!configured) {
		return Object.freeze({
			kind: 'configuration_required',
			title: 'Google Drive ainda não configurado',
			detail: 'Cadastre o cliente OAuth e os secrets no ambiente antes de conectar.',
			canConnect: false,
			canSynchronize: false
		});
	}

	if (connection === null || connection.status === 'disconnected') {
		return Object.freeze({
			kind: 'disconnected',
			title: 'Google Drive desconectado',
			detail: 'Conecte sua conta para criar ou localizar a pasta Fichário Digital.',
			canConnect: true,
			canSynchronize: false
		});
	}

	if (connection.status === 'connecting') {
		return Object.freeze({
			kind: 'connecting',
			title: 'Conectando ao Google Drive',
			detail: 'A autorização está sendo concluída com o escopo mínimo drive.file.',
			canConnect: false,
			canSynchronize: false
		});
	}

	if (connection.status === 'syncing') {
		return Object.freeze({
			kind: 'syncing',
			title: 'Sincronizando Google Drive',
			detail: 'Aplicando mudanças sem bloquear os demais itens da fila.',
			canConnect: false,
			canSynchronize: false
		});
	}

	if (connection.status === 'connected') {
		const syncedAt = formatSyncTime(connection.last_sync_completed_at);
		return Object.freeze({
			kind: 'connected',
			title: 'Google Drive conectado',
			detail: `${connection.google_email ?? 'Conta conectada'}${syncedAt ? ` · última sincronização em ${syncedAt}` : ' · sincronização inicial pendente'}`,
			canConnect: false,
			canSynchronize: true
		});
	}

	if (connection.status === 'revoked') {
		return Object.freeze({
			kind: 'revoked',
			title: 'Acesso ao Google Drive revogado',
			detail: 'Reconecte a conta. Os metadados e textos permanecem preservados.',
			canConnect: true,
			canSynchronize: false
		});
	}

	return Object.freeze({
		kind: 'error',
		title: 'Google Drive requer atenção',
		detail: connection.last_error_message ?? 'A sincronização falhou sem apagar o trabalho local.',
		canConnect: true,
		canSynchronize: false
	});
}
