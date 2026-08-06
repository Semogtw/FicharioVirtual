import type { FetchLike } from './google-oauth-http.ts';

export interface GoogleDriveItem {
	id: string;
	name: string;
	mimeType: string;
	parents: readonly string[];
	modifiedTime: string;
	version: string;
	md5Checksum: string | null;
	trashed: boolean;
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const VERSION = /^\d{1,32}$/;
const MD5 = /^[0-9a-f]{32}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ITEM_FIELDS = 'id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed';

function record(value: unknown): Record<string, unknown> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function hasControlCharacters(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0);
		return code !== undefined && (code < 32 || code === 127);
	});
}

function validAccessToken(value: string): string {
	if (value.length < 8 || value.length > 8192 || hasControlCharacters(value)) {
		throw new TypeError('Invalid Google Drive access token');
	}
	return value;
}

function validDriveId(value: string): string {
	if (!DRIVE_ID.test(value)) throw new TypeError('Invalid Google Drive mutation');
	return value;
}

function validName(value: string): string {
	const normalized = value.trim();
	if (normalized.length < 1 || normalized.length > 512 || hasControlCharacters(normalized)) {
		throw new TypeError('Invalid Google Drive mutation');
	}
	return normalized;
}

function parseItem(value: unknown, expectedId: string): GoogleDriveItem {
	const item = record(value);
	const allowed = [
		'id',
		'name',
		'mimeType',
		'parents',
		'modifiedTime',
		'version',
		'md5Checksum',
		'trashed'
	];
	if (
		!item ||
		!exactKeys(item, allowed) ||
		item.id !== expectedId ||
		typeof item.id !== 'string' ||
		!DRIVE_ID.test(item.id) ||
		typeof item.name !== 'string' ||
		item.name.trim().length < 1 ||
		item.name.trim().length > 512 ||
		hasControlCharacters(item.name) ||
		typeof item.mimeType !== 'string' ||
		item.mimeType.length < 1 ||
		item.mimeType.length > 256 ||
		hasControlCharacters(item.mimeType) ||
		!Array.isArray(item.parents) ||
		item.parents.length > 100 ||
		!item.parents.every((parent) => typeof parent === 'string' && DRIVE_ID.test(parent)) ||
		typeof item.modifiedTime !== 'string' ||
		!ISO_TIMESTAMP.test(item.modifiedTime) ||
		typeof item.version !== 'string' ||
		!VERSION.test(item.version) ||
		(item.md5Checksum !== undefined &&
			item.md5Checksum !== null &&
			(typeof item.md5Checksum !== 'string' || !MD5.test(item.md5Checksum))) ||
		typeof item.trashed !== 'boolean'
	) {
		throw new TypeError('Invalid Google Drive item response');
	}
	return Object.freeze({
		id: item.id,
		name: item.name.trim(),
		mimeType: item.mimeType,
		parents: Object.freeze([...item.parents]) as readonly string[],
		modifiedTime: item.modifiedTime,
		version: item.version,
		md5Checksum: typeof item.md5Checksum === 'string' ? item.md5Checksum : null,
		trashed: item.trashed
	});
}

async function strictJson(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error('Google Drive mutation failed');
	const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
	if (!contentType.includes('application/json')) throw new Error('Google Drive mutation failed');
	try {
		return await response.json();
	} catch {
		throw new Error('Google Drive mutation failed');
	}
}

function itemUrl(fileId: string): URL {
	return new URL(`https://www.googleapis.com/drive/v3/files/${validDriveId(fileId)}`);
}

export async function getGoogleDriveItem({
	accessToken,
	fileId,
	fetchImpl = fetch
}: {
	accessToken: string;
	fileId: string;
	fetchImpl?: FetchLike;
}): Promise<GoogleDriveItem> {
	const safeFileId = validDriveId(fileId);
	const url = itemUrl(safeFileId);
	url.searchParams.set('supportsAllDrives', 'false');
	url.searchParams.set('fields', ITEM_FIELDS);
	const response = await fetchImpl(url.toString(), {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${validAccessToken(accessToken)}`
		}
	});
	return parseItem(await strictJson(response), safeFileId);
}

export async function updateGoogleDriveItem({
	accessToken,
	fileId,
	name,
	addParentId,
	removeParentId,
	fetchImpl = fetch
}: {
	accessToken: string;
	fileId: string;
	name?: string;
	addParentId?: string;
	removeParentId?: string;
	fetchImpl?: FetchLike;
}): Promise<GoogleDriveItem> {
	if (name === undefined && addParentId === undefined && removeParentId === undefined) {
		throw new TypeError('Invalid Google Drive mutation');
	}
	if ((addParentId === undefined) !== (removeParentId === undefined)) {
		throw new TypeError('Invalid Google Drive mutation');
	}
	if (addParentId !== undefined && removeParentId !== undefined && addParentId === removeParentId) {
		throw new TypeError('Invalid Google Drive mutation');
	}

	const safeFileId = validDriveId(fileId);
	const url = itemUrl(safeFileId);
	url.searchParams.set('supportsAllDrives', 'false');
	url.searchParams.set('fields', ITEM_FIELDS);
	if (addParentId !== undefined && removeParentId !== undefined) {
		url.searchParams.set('addParents', validDriveId(addParentId));
		url.searchParams.set('removeParents', validDriveId(removeParentId));
	}
	const body = name === undefined ? {} : { name: validName(name) };
	const response = await fetchImpl(url.toString(), {
		method: 'PATCH',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${validAccessToken(accessToken)}`,
			'Content-Type': 'application/json; charset=UTF-8'
		},
		body: JSON.stringify(body)
	});
	return parseItem(await strictJson(response), safeFileId);
}

export async function deleteGoogleDriveItem({
	accessToken,
	fileId,
	fetchImpl = fetch
}: {
	accessToken: string;
	fileId: string;
	fetchImpl?: FetchLike;
}): Promise<void> {
	const url = itemUrl(fileId);
	url.searchParams.set('supportsAllDrives', 'false');
	const response = await fetchImpl(url.toString(), {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${validAccessToken(accessToken)}` }
	});
	if (response.status === 204 || response.status === 404) return;
	throw new Error('Google Drive mutation failed');
}
