import type { FetchLike } from './google-oauth-http.ts';

export interface GoogleDriveChangedFile {
	id: string;
	name: string;
	mimeType: string;
	parents: readonly string[];
	modifiedTime: string;
	version: string;
	md5Checksum: string | null;
	trashed: boolean;
}

export type GoogleDriveChange =
	| Readonly<{ fileId: string; removed: true }>
	| Readonly<{ fileId: string; removed: false; file: GoogleDriveChangedFile }>;

export interface GoogleDriveChangePage {
	changes: readonly GoogleDriveChange[];
	nextPageToken: string | null;
	newStartPageToken: string | null;
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const VERSION = /^\d{1,32}$/;
const MD5 = /^[0-9a-f]{32}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const CHANGE_FIELDS =
	'changes(fileId,removed,file(id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed)),nextPageToken,newStartPageToken';

function objectRecord(value: unknown): Record<string, unknown> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(record).every((key) => allowed.includes(key));
}

function hasControlCharacters(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0);
		return code !== undefined && (code < 32 || code === 127);
	});
}

function validAccessToken(value: string): string {
	if (
		value.length < 8 ||
		value.length > 8192 ||
		hasControlCharacters(value)
	) {
		throw new TypeError('Invalid Google Drive access token');
	}
	return value;
}

function validPageToken(value: string): string {
	const normalized = value.trim();
	if (normalized.length < 1 || normalized.length > 4096 || hasControlCharacters(normalized)) {
		throw new TypeError('Invalid Google Drive page token');
	}
	return normalized;
}

function parseOptionalPageToken(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string') throw new TypeError('Invalid Google Drive change response');
	try {
		return validPageToken(value);
	} catch {
		throw new TypeError('Invalid Google Drive change response');
	}
}

function parseChangedFile(value: unknown): GoogleDriveChangedFile {
	const record = objectRecord(value);
	if (
		!record ||
		!exactKeys(record, [
			'id',
			'name',
			'mimeType',
			'parents',
			'modifiedTime',
			'version',
			'md5Checksum',
			'trashed'
		]) ||
		typeof record.id !== 'string' ||
		!DRIVE_ID.test(record.id) ||
		typeof record.name !== 'string' ||
		record.name.trim().length < 1 ||
		record.name.trim().length > 512 ||
		hasControlCharacters(record.name) ||
		typeof record.mimeType !== 'string' ||
		record.mimeType.length < 1 ||
		record.mimeType.length > 256 ||
		hasControlCharacters(record.mimeType) ||
		!Array.isArray(record.parents) ||
		record.parents.length > 100 ||
		!record.parents.every((parent) => typeof parent === 'string' && DRIVE_ID.test(parent)) ||
		typeof record.modifiedTime !== 'string' ||
		!ISO_TIMESTAMP.test(record.modifiedTime) ||
		typeof record.version !== 'string' ||
		!VERSION.test(record.version) ||
		(record.md5Checksum !== undefined &&
			record.md5Checksum !== null &&
			(typeof record.md5Checksum !== 'string' || !MD5.test(record.md5Checksum))) ||
		typeof record.trashed !== 'boolean'
	) {
		throw new TypeError('Invalid Google Drive change response');
	}
	return Object.freeze({
		id: record.id,
		name: record.name.trim(),
		mimeType: record.mimeType,
		parents: Object.freeze([...record.parents]) as readonly string[],
		modifiedTime: record.modifiedTime,
		version: record.version,
		md5Checksum: typeof record.md5Checksum === 'string' ? record.md5Checksum : null,
		trashed: record.trashed
	});
}

function parseChange(value: unknown): GoogleDriveChange {
	const record = objectRecord(value);
	if (
		!record ||
		!exactKeys(record, ['kind', 'type', 'fileId', 'removed', 'file']) ||
		(record.kind !== undefined && record.kind !== 'drive#change') ||
		(record.type !== undefined && record.type !== 'file') ||
		typeof record.fileId !== 'string' ||
		!DRIVE_ID.test(record.fileId) ||
		typeof record.removed !== 'boolean'
	) {
		throw new TypeError('Invalid Google Drive change response');
	}
	if (record.removed) {
		if (record.file !== undefined) throw new TypeError('Invalid Google Drive change response');
		return Object.freeze({ fileId: record.fileId, removed: true });
	}
	const file = parseChangedFile(record.file);
	if (file.id !== record.fileId) throw new TypeError('Invalid Google Drive change response');
	return Object.freeze({ fileId: record.fileId, removed: false, file });
}

function parseChangePage(value: unknown): GoogleDriveChangePage {
	const record = objectRecord(value);
	if (
		!record ||
		!exactKeys(record, ['kind', 'changes', 'nextPageToken', 'newStartPageToken']) ||
		(record.kind !== undefined && record.kind !== 'drive#changeList') ||
		!Array.isArray(record.changes) ||
		record.changes.length > 100
	) {
		throw new TypeError('Invalid Google Drive change response');
	}
	const changes = record.changes.map(parseChange);
	if (new Set(changes.map((change) => change.fileId)).size !== changes.length) {
		throw new TypeError('Invalid Google Drive change response');
	}
	const nextPageToken = parseOptionalPageToken(record.nextPageToken);
	const newStartPageToken = parseOptionalPageToken(record.newStartPageToken);
	if ((nextPageToken === null) === (newStartPageToken === null)) {
		throw new TypeError('Invalid Google Drive change response');
	}
	return Object.freeze({
		changes: Object.freeze(changes),
		nextPageToken,
		newStartPageToken
	});
}

async function strictJson(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error('Google Drive change request failed');
	const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
	if (!contentType.includes('application/json')) {
		throw new Error('Google Drive change request failed');
	}
	try {
		return await response.json();
	} catch {
		throw new Error('Google Drive change request failed');
	}
}

export async function listGoogleDriveChanges({
	accessToken,
	pageToken,
	fetchImpl = fetch
}: {
	accessToken: string;
	pageToken: string;
	fetchImpl?: FetchLike;
}): Promise<GoogleDriveChangePage> {
	const safeAccessToken = validAccessToken(accessToken);
	const safePageToken = validPageToken(pageToken);
	const url = new URL('https://www.googleapis.com/drive/v3/changes');
	url.searchParams.set('pageToken', safePageToken);
	url.searchParams.set('pageSize', '100');
	url.searchParams.set('spaces', 'drive');
	url.searchParams.set('includeRemoved', 'true');
	url.searchParams.set('supportsAllDrives', 'false');
	url.searchParams.set('includeItemsFromAllDrives', 'false');
	url.searchParams.set('fields', CHANGE_FIELDS);
	const response = await fetchImpl(url.toString(), {
		headers: { Accept: 'application/json', Authorization: `Bearer ${safeAccessToken}` }
	});
	return parseChangePage(await strictJson(response));
}
