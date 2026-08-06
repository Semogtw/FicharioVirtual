import { parseDriveChangePage } from './contracts';
import type { DriveChange } from './types';

export type DriveConflictKind =
	| 'ambiguous_order'
	| 'identity_mismatch'
	| 'remote_deleted_local_changed'
	| 'local_deleted_remote_changed';

export type DriveApplyOutcome =
	| { status: 'applied' }
	| { status: 'conflict'; kind: DriveConflictKind };

export interface DriveSyncGateway {
	fetchChangePage(pageToken: string): Promise<unknown>;
	applyChange(change: DriveChange): Promise<DriveApplyOutcome>;
	recordConflict(change: DriveChange, kind: DriveConflictKind): Promise<void>;
	persistCheckpoint(pageToken: string): Promise<void>;
}

export interface DriveSyncResult {
	appliedChanges: number;
	conflicts: number;
	pages: number;
	startPageToken: string;
}

function validPageToken(value: string): string {
	const normalized = value.trim();
	if (normalized.length === 0 || normalized.length > 4_096) {
		throw new TypeError('Invalid Drive page token');
	}
	return normalized;
}

function validOutcome(outcome: DriveApplyOutcome): DriveApplyOutcome {
	if (outcome.status === 'applied') return outcome;
	if (
		outcome.status === 'conflict' &&
		[
			'ambiguous_order',
			'identity_mismatch',
			'remote_deleted_local_changed',
			'local_deleted_remote_changed'
		].includes(outcome.kind)
	) {
		return outcome;
	}
	throw new TypeError('Invalid Drive apply outcome');
}

export async function synchronizeDriveChanges({
	startPageToken,
	gateway
}: {
	startPageToken: string;
	gateway: DriveSyncGateway;
}): Promise<DriveSyncResult> {
	let pageToken = validPageToken(startPageToken);
	let appliedChanges = 0;
	let conflicts = 0;
	let pages = 0;
	const seenTokens = new Set<string>();

	while (true) {
		if (seenTokens.has(pageToken) || seenTokens.size >= 10_000) {
			throw new Error('Drive change feed did not advance');
		}
		seenTokens.add(pageToken);

		const page = parseDriveChangePage(await gateway.fetchChangePage(pageToken));
		for (const change of page.changes) {
			const outcome = validOutcome(await gateway.applyChange(change));
			if (outcome.status === 'conflict') {
				await gateway.recordConflict(change, outcome.kind);
				conflicts += 1;
			} else {
				appliedChanges += 1;
			}
		}

		const checkpoint = validPageToken(page.nextPageToken ?? page.newStartPageToken ?? '');
		await gateway.persistCheckpoint(checkpoint);
		pages += 1;

		if (page.nextPageToken === null) {
			return Object.freeze({
				appliedChanges,
				conflicts,
				pages,
				startPageToken: checkpoint
			});
		}
		pageToken = checkpoint;
	}
}
