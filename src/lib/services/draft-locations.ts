import { z } from 'zod';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const draftLocationRowSchema = z
	.object({
		page_id: z.string().regex(UUID),
		document_id: z.string().regex(UUID),
		document_title: z.string().trim().min(1).max(240),
		page_number: z.number().int().min(1).max(10_000),
		page_updated_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)))
	})
	.strict();
const draftLocationRowsSchema = z.array(draftLocationRowSchema).max(100);

type DraftLocationRow = z.infer<typeof draftLocationRowSchema>;

export type DraftLocation = {
	pageId: string;
	documentId: string;
	documentTitle: string;
	pageNumber: number;
	pageUpdatedAt: string;
};

export type DraftLocationClientLike = {
	rpc(
		name: 'resolve_page_locations',
		args: { target_page_ids: string[] }
	): Promise<{ data: unknown; error: unknown }>;
};

export class DraftLocationError extends Error {
	constructor() {
		super('Não foi possível localizar os rascunhos.');
		this.name = 'DraftLocationError';
	}
}

function defaultClient(): DraftLocationClientLike {
	return getSupabaseClient() as unknown as DraftLocationClientLike;
}

function mapRow(row: DraftLocationRow): DraftLocation {
	return Object.freeze({
		pageId: row.page_id,
		documentId: row.document_id,
		documentTitle: row.document_title,
		pageNumber: row.page_number,
		pageUpdatedAt: row.page_updated_at
	});
}

export async function resolveDraftLocations(
	pageIds: readonly string[],
	client?: DraftLocationClientLike
): Promise<readonly DraftLocation[]> {
	if (pageIds.length === 0) return Object.freeze([]);
	if (pageIds.length > 100) throw new TypeError('Too many draft locations');
	const uniqueIds = [...new Set(pageIds)];
	if (uniqueIds.some((value) => !UUID.test(value))) {
		throw new TypeError('Invalid draft page identifier');
	}
	try {
		const gateway = client ?? defaultClient();
		const { data, error } = await gateway.rpc('resolve_page_locations', {
			target_page_ids: uniqueIds
		});
		if (error) throw new DraftLocationError();
		const requestedIds = new Set(uniqueIds);
		const seenIds = new Set<string>();
		const rows = draftLocationRowsSchema.parse(data);
		for (const row of rows) {
			if (!requestedIds.has(row.page_id) || seenIds.has(row.page_id)) {
				throw new DraftLocationError();
			}
			seenIds.add(row.page_id);
		}
		return Object.freeze(rows.map(mapRow));
	} catch {
		throw new DraftLocationError();
	}
}
