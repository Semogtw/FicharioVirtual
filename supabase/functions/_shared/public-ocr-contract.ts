const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicOcrRequest = Readonly<{
	pageIds: readonly string[];
	batchId: string | null;
}>;

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function parsePublicOcrRequest(body: unknown, maxPages: number): PublicOcrRequest | null {
	if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
	const record = body as Record<string, unknown>;
	if (!hasExactKeys(record, ['pageIds']) && !hasExactKeys(record, ['batchId', 'pageIds'])) {
		return null;
	}
	if (
		!Array.isArray(record.pageIds) ||
		record.pageIds.length < 1 ||
		record.pageIds.length > maxPages ||
		record.pageIds.some((value) => typeof value !== 'string' || !UUID.test(value)) ||
		new Set(record.pageIds).size !== record.pageIds.length ||
		(record.batchId !== undefined &&
			(typeof record.batchId !== 'string' || !UUID.test(record.batchId)))
	) {
		return null;
	}
	return Object.freeze({
		pageIds: Object.freeze([...(record.pageIds as string[])]),
		batchId: typeof record.batchId === 'string' ? record.batchId : null
	});
}
