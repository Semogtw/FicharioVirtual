import type { GoogleDriveItem } from './google-drive-mutations.ts';

export type ClaimedDriveOperation =
	'create_folder' | 'rename_folder' | 'move_folder' | 'update_file' | 'delete_permanently';

export interface ClaimedDriveJob {
	id: string;
	operation: ClaimedDriveOperation;
	documentId: string | null;
	notebookId: string | null;
	driveFileId: string | null;
	payload: Readonly<Record<string, unknown>>;
	attemptCount: number;
	leaseExpiresAt: string;
}

export interface DriveJobNotebook {
	id: string;
	name: string;
	parentNotebookId: string | null;
	driveFolderId: string | null;
}

export interface DriveJobDocument {
	id: string;
	kind: 'image' | 'pdf';
	notebookId: string | null;
	driveFileId: string;
	driveParentFolderId: string;
	driveMimeType: string;
}

export interface DriveJobGateway {
	loadNotebook(notebookId: string): Promise<DriveJobNotebook>;
	loadDocument(documentId: string): Promise<DriveJobDocument>;
	resolveFolder(notebookId: string | null): Promise<string>;
	ensureFolder(name: string, parentFolderId: string): Promise<GoogleDriveItem>;
	getItem(fileId: string): Promise<GoogleDriveItem>;
	updateItem(input: {
		fileId: string;
		name?: string;
		addParentId?: string;
		removeParentId?: string;
	}): Promise<GoogleDriveItem>;
	deleteItem(fileId: string): Promise<void>;
	complete(
		job: ClaimedDriveJob,
		item: GoogleDriveItem | null,
		parentFolderId: string | null
	): Promise<void>;
	retry(job: ClaimedDriveJob, code: string, message: string): Promise<void>;
	conflict(
		job: ClaimedDriveJob,
		kind:
			| 'ambiguous_order'
			| 'identity_mismatch'
			| 'remote_deleted_local_changed'
			| 'local_deleted_remote_changed',
		localSnapshot: Readonly<Record<string, unknown>>,
		remoteSnapshot: Readonly<Record<string, unknown>>
	): Promise<void>;
}

export type DriveJobExecutionOutcome = 'synced' | 'retryable' | 'conflict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const OPERATIONS = new Set<ClaimedDriveOperation>([
	'create_folder',
	'rename_folder',
	'move_folder',
	'update_file',
	'delete_permanently'
]);

class DriveDependencyPendingError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const keys = Object.keys(value).sort();
	const expected = [...allowed].sort();
	return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function forbiddenPayload(value: unknown, depth = 0): boolean {
	if (depth > 8) return true;
	if (Array.isArray(value)) {
		return value.length > 100 || value.some((item) => forbiddenPayload(item, depth + 1));
	}
	if (value === null || typeof value !== 'object') {
		return typeof value === 'string' && value.length > 4_096;
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > 100) return true;
	return entries.some(
		([key, item]) =>
			/(?:access|refresh|id)[_-]?token|secret|authorization/i.test(key) ||
			forbiddenPayload(item, depth + 1)
	);
}

function freezeDeep<T>(value: T): T {
	if (Array.isArray(value)) {
		for (const item of value) freezeDeep(item);
		return Object.freeze(value);
	}
	if (value !== null && typeof value === 'object') {
		for (const item of Object.values(value as Record<string, unknown>)) freezeDeep(item);
		return Object.freeze(value);
	}
	return value;
}

export function parseClaimedDriveJob(value: unknown): ClaimedDriveJob {
	const row = record(value);
	if (
		!row ||
		!exactKeys(row, [
			'id',
			'operation',
			'document_id',
			'notebook_id',
			'drive_file_id',
			'payload',
			'attempt_count',
			'lease_expires_at'
		]) ||
		typeof row.id !== 'string' ||
		!UUID.test(row.id) ||
		typeof row.operation !== 'string' ||
		!OPERATIONS.has(row.operation as ClaimedDriveOperation) ||
		(row.document_id !== null &&
			(typeof row.document_id !== 'string' || !UUID.test(row.document_id))) ||
		(row.notebook_id !== null &&
			(typeof row.notebook_id !== 'string' || !UUID.test(row.notebook_id))) ||
		(row.drive_file_id !== null &&
			(typeof row.drive_file_id !== 'string' || !DRIVE_ID.test(row.drive_file_id))) ||
		!record(row.payload) ||
		forbiddenPayload(row.payload) ||
		typeof row.attempt_count !== 'number' ||
		!Number.isInteger(row.attempt_count) ||
		row.attempt_count < 1 ||
		row.attempt_count > 50 ||
		typeof row.lease_expires_at !== 'string' ||
		!ISO_TIMESTAMP.test(row.lease_expires_at)
	) {
		throw new TypeError('Invalid claimed Drive job');
	}

	const operation = row.operation as ClaimedDriveOperation;
	if (
		((operation === 'create_folder' ||
			operation === 'rename_folder' ||
			operation === 'move_folder') &&
			row.notebook_id === null) ||
		((operation === 'rename_folder' || operation === 'move_folder') &&
			row.drive_file_id === null) ||
		(operation === 'update_file' && (row.document_id === null || row.drive_file_id === null)) ||
		(operation === 'delete_permanently' && row.drive_file_id === null)
	) {
		throw new TypeError('Invalid claimed Drive job');
	}

	return Object.freeze({
		id: row.id,
		operation,
		documentId: row.document_id as string | null,
		notebookId: row.notebook_id as string | null,
		driveFileId: row.drive_file_id as string | null,
		payload: freezeDeep(structuredClone(row.payload as Record<string, unknown>)),
		attemptCount: row.attempt_count,
		leaseExpiresAt: row.lease_expires_at
	});
}

function localNotebookSnapshot(notebook: DriveJobNotebook): Readonly<Record<string, unknown>> {
	return Object.freeze({
		notebookId: notebook.id,
		name: notebook.name,
		parentNotebookId: notebook.parentNotebookId,
		driveFolderId: notebook.driveFolderId
	});
}

function localDocumentSnapshot(document: DriveJobDocument): Readonly<Record<string, unknown>> {
	return Object.freeze({
		documentId: document.id,
		kind: document.kind,
		notebookId: document.notebookId,
		driveFileId: document.driveFileId,
		driveParentFolderId: document.driveParentFolderId,
		driveMimeType: document.driveMimeType
	});
}

function remoteSnapshot(item: GoogleDriveItem): Readonly<Record<string, unknown>> {
	return Object.freeze({
		fileId: item.id,
		name: item.name,
		mimeType: item.mimeType,
		parents: Object.freeze([...item.parents]),
		modifiedTime: item.modifiedTime,
		version: item.version,
		trashed: item.trashed
	});
}

async function resolveFolder(gateway: DriveJobGateway, notebookId: string | null): Promise<string> {
	try {
		return await gateway.resolveFolder(notebookId);
	} catch {
		throw new DriveDependencyPendingError();
	}
}

function folderIdentityIsValid(item: GoogleDriveItem): boolean {
	return item.mimeType === FOLDER_MIME && !item.trashed;
}

function documentIdentityIsValid(item: GoogleDriveItem, document: DriveJobDocument): boolean {
	return (
		item.id === document.driveFileId && item.mimeType === document.driveMimeType && !item.trashed
	);
}

async function conflict(
	gateway: DriveJobGateway,
	job: ClaimedDriveJob,
	kind: 'ambiguous_order' | 'identity_mismatch',
	local: Readonly<Record<string, unknown>>,
	remote: Readonly<Record<string, unknown>>
): Promise<DriveJobExecutionOutcome> {
	await gateway.conflict(job, kind, local, remote);
	return 'conflict';
}

export async function executeDriveJob(
	job: ClaimedDriveJob,
	gateway: DriveJobGateway
): Promise<DriveJobExecutionOutcome> {
	try {
		if (job.operation === 'create_folder') {
			const notebook = await gateway.loadNotebook(job.notebookId as string);
			const parentFolderId = await resolveFolder(gateway, notebook.parentNotebookId);
			const created = await gateway.ensureFolder(notebook.name, parentFolderId);
			if (
				!folderIdentityIsValid(created) ||
				created.parents.length !== 1 ||
				created.parents[0] !== parentFolderId
			) {
				return conflict(
					gateway,
					job,
					'identity_mismatch',
					localNotebookSnapshot(notebook),
					remoteSnapshot(created)
				);
			}
			await gateway.complete(job, created, parentFolderId);
			return 'synced';
		}

		if (job.operation === 'rename_folder') {
			const notebook = await gateway.loadNotebook(job.notebookId as string);
			if (notebook.driveFolderId !== job.driveFileId) {
				return conflict(
					gateway,
					job,
					'identity_mismatch',
					localNotebookSnapshot(notebook),
					Object.freeze({ jobDriveFileId: job.driveFileId })
				);
			}
			const updated = await gateway.updateItem({
				fileId: job.driveFileId as string,
				name: notebook.name
			});
			if (!folderIdentityIsValid(updated) || updated.parents.length !== 1) {
				return conflict(
					gateway,
					job,
					updated.parents.length > 1 ? 'ambiguous_order' : 'identity_mismatch',
					localNotebookSnapshot(notebook),
					remoteSnapshot(updated)
				);
			}
			await gateway.complete(job, updated, updated.parents[0]);
			return 'synced';
		}

		if (job.operation === 'move_folder') {
			const notebook = await gateway.loadNotebook(job.notebookId as string);
			const current = await gateway.getItem(job.driveFileId as string);
			if (!folderIdentityIsValid(current) || notebook.driveFolderId !== current.id) {
				return conflict(
					gateway,
					job,
					'identity_mismatch',
					localNotebookSnapshot(notebook),
					remoteSnapshot(current)
				);
			}
			if (current.parents.length !== 1) {
				return conflict(
					gateway,
					job,
					'ambiguous_order',
					localNotebookSnapshot(notebook),
					remoteSnapshot(current)
				);
			}
			const parentFolderId = await resolveFolder(gateway, notebook.parentNotebookId);
			const updated =
				current.parents[0] === parentFolderId
					? current
					: await gateway.updateItem({
							fileId: current.id,
							addParentId: parentFolderId,
							removeParentId: current.parents[0]
						});
			await gateway.complete(job, updated, parentFolderId);
			return 'synced';
		}

		if (job.operation === 'update_file') {
			const document = await gateway.loadDocument(job.documentId as string);
			const current = await gateway.getItem(job.driveFileId as string);
			if (!documentIdentityIsValid(current, document)) {
				return conflict(
					gateway,
					job,
					'identity_mismatch',
					localDocumentSnapshot(document),
					remoteSnapshot(current)
				);
			}
			if (current.parents.length !== 1) {
				return conflict(
					gateway,
					job,
					'ambiguous_order',
					localDocumentSnapshot(document),
					remoteSnapshot(current)
				);
			}
			const parentFolderId = await resolveFolder(gateway, document.notebookId);
			const updated =
				current.parents[0] === parentFolderId
					? current
					: await gateway.updateItem({
							fileId: current.id,
							addParentId: parentFolderId,
							removeParentId: current.parents[0]
						});
			await gateway.complete(job, updated, parentFolderId);
			return 'synced';
		}

		await gateway.deleteItem(job.driveFileId as string);
		await gateway.complete(job, null, null);
		return 'synced';
	} catch (error) {
		if (error instanceof DriveDependencyPendingError) {
			await gateway.retry(
				job,
				'drive_dependency_pending',
				'A pasta de destino ainda não está sincronizada.'
			);
			return 'retryable';
		}
		await gateway.retry(
			job,
			'drive_request_failed',
			'O Google Drive não concluiu a operação. Uma nova tentativa será feita.'
		);
		return 'retryable';
	}
}
