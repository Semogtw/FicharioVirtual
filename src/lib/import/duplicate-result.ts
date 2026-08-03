const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDuplicateDocumentId(data: unknown): string | null {
	if (data === null) return null;
	if (typeof data !== 'object' || Array.isArray(data)) {
		throw new TypeError('Invalid duplicate document response');
	}
	const value = data as Record<string, unknown>;
	const keys = Object.keys(value);
	if (
		keys.length !== 1 ||
		keys[0] !== 'id' ||
		typeof value.id !== 'string' ||
		!UUID.test(value.id)
	) {
		throw new TypeError('Invalid duplicate document response');
	}
	return value.id;
}
