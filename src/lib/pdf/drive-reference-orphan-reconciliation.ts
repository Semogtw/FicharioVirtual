import type { SupabaseClient } from '@supabase/supabase-js';
import {
	deleteBrowserDriveFile,
	listBrowserDrivePdfReferenceCopies,
	type BrowserDrivePdfReferenceCopy
} from '$lib/drive/browser-files';
import type { DriveTokenClientLike } from '$lib/drive/browser-upload';
import { getSupabaseClient } from '$lib/services/supabase';
import type { Database } from '$lib/types/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MINIMUM_SAFE_AGE_MS = 60 * 60 * 1000;
const MAXIMUM_SAFE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DATABASE_BATCH_SIZE = 100;

export const DRIVE_PDF_ORPHAN_GRACE_MS = MINIMUM_SAFE_AGE_MS;

type ReconciliationClient = DriveTokenClientLike & SupabaseClient<Database>;

export type DrivePdfOrphanReconciliationResult = Readonly<{
	scanned: number;
	eligible: number;
	deleted: number;
	failed: number;
	preserved: number;
}>;

export interface DrivePdfOrphanReconciliationDependencies {
	listCopies(input: {
		client: DriveTokenClientLike;
	}): Promise<readonly BrowserDrivePdfReferenceCopy[]>;
	findExistingDocumentIds(
		documentIds: readonly string[],
		client: ReconciliationClient
	): Promise<ReadonlySet<string>>;
	deleteFile(input: { client: DriveTokenClientLike; fileId: string }): Promise<void>;
}

function validateTiming(nowMs: number, minimumAgeMs: number) {
	if (
		!Number.isSafeInteger(nowMs) ||
		nowMs < 1 ||
		!Number.isSafeInteger(minimumAgeMs) ||
		minimumAgeMs < MINIMUM_SAFE_AGE_MS ||
		minimumAgeMs > MAXIMUM_SAFE_AGE_MS
	) {
		throw new TypeError('Invalid Drive PDF orphan reconciliation window');
	}
}

function validateCopy(copy: BrowserDrivePdfReferenceCopy) {
	const createdAtMs = Date.parse(copy.createdAt);
	if (
		!DRIVE_ID.test(copy.fileId) ||
		!UUID.test(copy.documentId) ||
		!DRIVE_ID.test(copy.parentFolderId) ||
		!Number.isFinite(createdAtMs)
	) {
		throw new TypeError('Invalid managed Drive PDF reference copy');
	}
	return createdAtMs;
}

async function findExistingDocumentIds(
	documentIds: readonly string[],
	client: ReconciliationClient
): Promise<ReadonlySet<string>> {
	const unique = [...new Set(documentIds)];
	for (const documentId of unique) {
		if (!UUID.test(documentId)) throw new TypeError('Invalid Drive PDF reference document id');
	}
	const existing = new Set<string>();
	for (let offset = 0; offset < unique.length; offset += DATABASE_BATCH_SIZE) {
		const batch = unique.slice(offset, offset + DATABASE_BATCH_SIZE);
		const { data, error } = await client.from('documents').select('id').in('id', batch);
		if (error) throw error;
		if (!Array.isArray(data)) throw new Error('Invalid Drive PDF reconciliation database response');
		for (const row of data) {
			if (
				row === null ||
				typeof row !== 'object' ||
				Array.isArray(row) ||
				Object.keys(row).length !== 1 ||
				typeof (row as { id?: unknown }).id !== 'string' ||
				!UUID.test((row as { id: string }).id) ||
				!batch.includes((row as { id: string }).id)
			) {
				throw new Error('Invalid Drive PDF reconciliation database response');
			}
			existing.add((row as { id: string }).id);
		}
	}
	return existing;
}

const defaultDependencies: DrivePdfOrphanReconciliationDependencies = {
	listCopies: ({ client }) => listBrowserDrivePdfReferenceCopies({ client }),
	findExistingDocumentIds,
	deleteFile: deleteBrowserDriveFile
};

export async function reconcileOrphanedDrivePdfReferenceCopies({
	client = getSupabaseClient() as ReconciliationClient,
	nowMs = Date.now(),
	minimumAgeMs = DRIVE_PDF_ORPHAN_GRACE_MS,
	dependencies = defaultDependencies
}: {
	client?: ReconciliationClient;
	nowMs?: number;
	minimumAgeMs?: number;
	dependencies?: DrivePdfOrphanReconciliationDependencies;
} = {}): Promise<DrivePdfOrphanReconciliationResult> {
	validateTiming(nowMs, minimumAgeMs);
	const copies = await dependencies.listCopies({ client });
	const eligible: BrowserDrivePdfReferenceCopy[] = [];
	const seenFileIds = new Set<string>();
	for (const copy of copies) {
		const createdAtMs = validateCopy(copy);
		if (seenFileIds.has(copy.fileId)) continue;
		seenFileIds.add(copy.fileId);
		if (nowMs - createdAtMs >= minimumAgeMs) eligible.push(copy);
	}

	const existingDocumentIds = await dependencies.findExistingDocumentIds(
		eligible.map((copy) => copy.documentId),
		client
	);
	let deleted = 0;
	let failed = 0;
	for (const copy of eligible) {
		if (existingDocumentIds.has(copy.documentId)) continue;
		try {
			await dependencies.deleteFile({ client, fileId: copy.fileId });
			deleted += 1;
		} catch {
			failed += 1;
		}
	}

	return Object.freeze({
		scanned: copies.length,
		eligible: eligible.length,
		deleted,
		failed,
		preserved: copies.length - deleted - failed
	});
}
