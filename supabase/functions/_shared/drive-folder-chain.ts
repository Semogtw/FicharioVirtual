export interface DriveNotebookRow {
	id: string;
	name: string;
	parentNotebookId: string | null;
	driveFolderId: string | null;
	driveMissing: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;

function hasControlCharacters(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0);
		return code !== undefined && (code < 32 || code === 127);
	});
}

function invalid(): never {
	throw new TypeError('Invalid Drive notebook response');
}

export function parseDriveNotebookRows(value: unknown): readonly DriveNotebookRow[] {
	if (!Array.isArray(value) || value.length > 1_000) invalid();
	const ids = new Set<string>();
	const rows = value.map((item) => {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) invalid();
		const record = item as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		if (keys.join(',') !== 'drive_folder_id,drive_missing,id,name,parent_notebook_id') invalid();
		if (
			typeof record.id !== 'string' ||
			!UUID.test(record.id) ||
			ids.has(record.id) ||
			typeof record.name !== 'string' ||
			record.name.trim().length < 1 ||
			record.name.trim().length > 120 ||
			hasControlCharacters(record.name) ||
			(record.parent_notebook_id !== null &&
				(typeof record.parent_notebook_id !== 'string' || !UUID.test(record.parent_notebook_id))) ||
			(record.drive_folder_id !== null &&
				(typeof record.drive_folder_id !== 'string' || !DRIVE_ID.test(record.drive_folder_id))) ||
			typeof record.drive_missing !== 'boolean'
		) {
			invalid();
		}
		ids.add(record.id);
		return Object.freeze({
			id: record.id,
			name: record.name.trim(),
			parentNotebookId: record.parent_notebook_id as string | null,
			driveFolderId: record.drive_folder_id as string | null,
			driveMissing: record.drive_missing
		});
	});
	return Object.freeze(rows);
}

export function buildNotebookFolderChain(
	rows: readonly DriveNotebookRow[],
	targetNotebookId: string
): readonly DriveNotebookRow[] {
	if (!UUID.test(targetNotebookId)) throw new TypeError('Invalid Drive notebook hierarchy');
	const byId = new Map(rows.map((row) => [row.id, row]));
	const chain: DriveNotebookRow[] = [];
	const visited = new Set<string>();
	let current = byId.get(targetNotebookId);
	while (current) {
		if (visited.has(current.id) || chain.length >= 100) {
			throw new TypeError('Invalid Drive notebook hierarchy');
		}
		visited.add(current.id);
		chain.push(current);
		if (current.parentNotebookId === null) break;
		current = byId.get(current.parentNotebookId);
		if (!current) throw new TypeError('Invalid Drive notebook hierarchy');
	}
	if (chain.length === 0) throw new TypeError('Invalid Drive notebook hierarchy');
	return Object.freeze(chain.reverse());
}
