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
			title: 'Indisponível',
			detail: 'O Google Drive está temporariamente indisponível. Tente novamente mais tarde.',
			canConnect: false,
			canSynchronize: false
		});
	}

	if (connection === null || connection.status === 'disconnected') {
		return Object.freeze({
			kind: 'disconnected',
			title: 'Não conectado',
			detail: 'Conecte sua conta para guardar e sincronizar seus arquivos.',
			canConnect: true,
			canSynchronize: false
		});
	}

	if (connection.status === 'connecting') {
		return Object.freeze({
			kind: 'connecting',
			title: 'Conectando…',
			detail: 'Estamos terminando de conectar sua conta.',
			canConnect: false,
			canSynchronize: false
		});
	}

	if (connection.status === 'syncing') {
		return Object.freeze({
			kind: 'syncing',
			title: 'Sincronizando…',
			detail: 'Seus arquivos estão sendo atualizados.',
			canConnect: false,
			canSynchronize: false
		});
	}

	if (connection.status === 'connected') {
		return Object.freeze({
			kind: 'connected',
			title: 'Conectado',
			detail: connection.google_email
				? `${connection.google_email} está conectado ao Fichário.`
				: 'Sua conta está conectada ao Fichário.',
			canConnect: false,
			canSynchronize: true
		});
	}

	if (connection.status === 'revoked') {
		return Object.freeze({
			kind: 'revoked',
			title: 'Conexão encerrada',
			detail: 'Conecte novamente para continuar usando o Google Drive.',
			canConnect: true,
			canSynchronize: false
		});
	}

	return Object.freeze({
		kind: 'error',
		title: 'Não foi possível conectar',
		detail: 'Tente conectar novamente. Seus arquivos no Fichário continuam preservados.',
		canConnect: true,
		canSynchronize: false
	});
}
