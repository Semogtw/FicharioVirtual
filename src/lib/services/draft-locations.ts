import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DraftLocation = {
	pageId: string;
	documentId: string;
	documentTitle: string;
	pageNumber: number;
	pageUpdatedAt: string;
};

type DraftLocationRow = {
	page_id: string;
	document_id: string;
	document_title: string;
	page_number: number;
	page_updated_at: string;
};

export type DraftLocationClientLike = {
	rpc(
		name: 'resolve_page_locations',
		args: { target_page_ids: string[] }
	): Promise<{ data: unknown; error: unknown }>;
};

function defaultClient(): DraftLocationClientLike {
	return getSupabaseClient() as unknown as DraftLocationClientLike;
}

export async function resolveDraftLocations(
	pageIds: readonly string[],
	client: DraftLocationClientLike = defaultClient()
): Promise<readonly DraftLocation[]> {
	if (pageIds.length === 0) return Object.freeze([]);
	if (pageIds.length > 100) throw new TypeError('Too many draft locations');
	const uniqueIds = [...new Set(pageIds)];
	if (uniqueIds.some((value) => !UUID.test(value))) {
		throw new TypeError('Invalid draft page identifier');
	}
	const { data, error } = await client.rpc('resolve_page_locations', {
		target_page_ids: uniqueIds
	});
	if (error || !Array.isArray(data)) throw new Error('Não foi possível localizar os rascunhos.');
	return Object.freeze(
		(data as DraftLocationRow[]).map((row) =>
			Object.freeze({
				pageId: row.page_id,
				documentId: row.document_id,
				documentTitle: row.document_title,
				pageNumber: row.page_number,
				pageUpdatedAt: row.page_updated_at
			})
		)
	);
}
