import { getSupabaseClient } from '$lib/services/supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;

export type ResumableDrivePdfReference = Readonly<{
	documentId: string;
	driveFileId: string;
	sourceSizeBytes: number;
	status: 'pending_inspection' | 'inspecting' | 'ready_to_finalize' | 'failed';
	title: string;
	sourceModifiedAt: string;
	updatedAt: string;
}>;

type RpcClient = {
	rpc(
		name: 'list_drive_pdf_reference_imports',
		args?: Record<string, never>
	): Promise<{ data: unknown; error: unknown }>;
};

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function normalizeIso(value: unknown): string | null {
	if (typeof value !== 'string' || value.length < 20 || value.length > 40) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseReference(value: unknown): ResumableDrivePdfReference {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid Drive PDF reference list');
	}
	const record = value as Record<string, unknown>;
	const sourceModifiedAt = normalizeIso(record.sourceModifiedAt);
	const updatedAt = normalizeIso(record.updatedAt);
	if (
		!hasExactKeys(record, [
			'documentId',
			'driveFileId',
			'sourceSizeBytes',
			'status',
			'title',
			'sourceModifiedAt',
			'updatedAt'
		]) ||
		typeof record.documentId !== 'string' ||
		!UUID.test(record.documentId) ||
		typeof record.driveFileId !== 'string' ||
		!DRIVE_ID.test(record.driveFileId) ||
		typeof record.sourceSizeBytes !== 'number' ||
		!Number.isSafeInteger(record.sourceSizeBytes) ||
		record.sourceSizeBytes < 1 ||
		!['pending_inspection', 'inspecting', 'ready_to_finalize', 'failed'].includes(
			String(record.status)
		) ||
		typeof record.title !== 'string' ||
		record.title.trim().length < 1 ||
		record.title.length > 240 ||
		sourceModifiedAt === null ||
		updatedAt === null
	) {
		throw new TypeError('Invalid Drive PDF reference list');
	}
	return Object.freeze({
		documentId: record.documentId,
		driveFileId: record.driveFileId,
		sourceSizeBytes: record.sourceSizeBytes,
		status: record.status as ResumableDrivePdfReference['status'],
		title: record.title,
		sourceModifiedAt,
		updatedAt
	});
}

export async function listDrivePdfReferences(
	client: RpcClient = getSupabaseClient() as unknown as RpcClient
): Promise<readonly ResumableDrivePdfReference[]> {
	const { data, error } = await client.rpc('list_drive_pdf_reference_imports');
	if (error) throw new Error('Não foi possível carregar os PDFs grandes pendentes.');
	if (!Array.isArray(data)) throw new TypeError('Invalid Drive PDF reference list');
	return Object.freeze(data.map(parseReference));
}
