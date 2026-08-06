import type { FetchLike } from './google-oauth-http.ts';

export interface GoogleDriveFolder {
	id: string;
	name: string;
	mimeType: 'application/vnd.google-apps.folder';
	parents: readonly string[];
	modifiedTime: string;
	version: string;
	trashed: boolean;
	md5Checksum?: string;
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const FOLDER_MIME = 'application/vnd.google-apps.folder' as const;
const FILE_FIELDS =
	'files(id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed),nextPageToken';
const SINGLE_FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed';

function record(value: unknown): Record<string, unknown> | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function validToken(value: string): string {
	if (
		value.length < 8 ||
		value.length > 8192 ||
		[...value].some((character) => {
			const code = character.codePointAt(0);
			return code !== undefined && (code < 32 || code === 127);
		})
	) {
		throw new TypeError('Invalid Google Drive access token');
	}
	return value;
}

function validQuery(value: string): string {
	if (
		value.length < 1 ||
		value.length > 2048 ||
		[...value].some((character) => {
			const code = character.codePointAt(0);
			return code !== undefined && (code < 32 || code === 127);
		})
	) {
		throw new TypeError('Invalid Google Drive query');
	}
	return value;
}

function validName(value: string): string {
	const normalized = value.trim();
	if (
		normalized.length < 1 ||
		normalized.length > 512 ||
		[...normalized].some((character) => {
			const code = character.codePointAt(0);
			return code !== undefined && (code < 32 || code === 127);
		})
	) {
		throw new TypeError('Invalid Google Drive folder name');
	}
	return normalized;
}

function parseFolder(value: unknown): GoogleDriveFolder {
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
		typeof item.id !== 'string' ||
		!DRIVE_ID.test(item.id) ||
		typeof item.name !== 'string' ||
		item.name.length < 1 ||
		item.name.length > 512 ||
		item.mimeType !== FOLDER_MIME ||
		!Array.isArray(item.parents) ||
		item.parents.length > 100 ||
		!item.parents.every((parent) => typeof parent === 'string' && DRIVE_ID.test(parent)) ||
		typeof item.modifiedTime !== 'string' ||
		!ISO_TIMESTAMP.test(item.modifiedTime) ||
		typeof item.version !== 'string' ||
		!/^\d{1,32}$/.test(item.version) ||
		item.trashed !== false ||
		(item.md5Checksum !== undefined &&
			(typeof item.md5Checksum !== 'string' || !/^[0-9a-f]{32}$/i.test(item.md5Checksum)))
	) {
		throw new TypeError('Invalid Google Drive folder response');
	}
	return Object.freeze({
		id: item.id,
		name: item.name,
		mimeType: FOLDER_MIME,
		parents: Object.freeze([...item.parents]) as readonly string[],
		modifiedTime: item.modifiedTime,
		version: item.version,
		trashed: false,
		...(typeof item.md5Checksum === 'string' ? { md5Checksum: item.md5Checksum } : {})
	});
}

async function jsonResponse(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error('Google Drive request failed');
	if (!(response.headers.get('Content-Type') ?? '').toLowerCase().includes('application/json')) {
		throw new Error('Google Drive request failed');
	}
	try {
		return await response.json();
	} catch {
		throw new Error('Google Drive request failed');
	}
}

function authorization(accessToken: string) {
	return { Accept: 'application/json', Authorization: `Bearer ${validToken(accessToken)}` };
}

export async function listDriveFolders({
	accessToken,
	query,
	fetchImpl = fetch
}: {
	accessToken: string;
	query: string;
	fetchImpl?: FetchLike;
}): Promise<readonly GoogleDriveFolder[]> {
	const url = new URL('https://www.googleapis.com/drive/v3/files');
	url.searchParams.set('q', validQuery(query));
	url.searchParams.set('spaces', 'drive');
	url.searchParams.set('pageSize', '10');
	url.searchParams.set('fields', FILE_FIELDS);
	const body = record(
		await jsonResponse(
			await fetchImpl(url.toString(), { headers: authorization(accessToken) })
		)
	);
	if (!body || !exactKeys(body, ['files', 'nextPageToken']) || !Array.isArray(body.files)) {
		throw new TypeError('Invalid Google Drive folder list response');
	}
	const folders = body.files.map(parseFolder);
	if (new Set(folders.map((folder) => folder.id)).size !== folders.length) {
		throw new TypeError('Invalid Google Drive folder list response');
	}
	return Object.freeze(folders);
}

export async function createDriveFolder({
	accessToken,
	name,
	fetchImpl = fetch
}: {
	accessToken: string;
	name: string;
	fetchImpl?: FetchLike;
}): Promise<GoogleDriveFolder> {
	const url = new URL('https://www.googleapis.com/drive/v3/files');
	url.searchParams.set('fields', SINGLE_FILE_FIELDS);
	const response = await fetchImpl(url.toString(), {
		method: 'POST',
		headers: {
			...authorization(accessToken),
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ name: validName(name), mimeType: FOLDER_MIME })
	});
	return parseFolder(await jsonResponse(response));
}

export async function getDriveStartPageToken({
	accessToken,
	fetchImpl = fetch
}: {
	accessToken: string;
	fetchImpl?: FetchLike;
}): Promise<string> {
	validToken(accessToken);
	const url = new URL('https://www.googleapis.com/drive/v3/changes/startPageToken');
	url.searchParams.set('supportsAllDrives', 'false');
	const body = record(
		await jsonResponse(
			await fetchImpl(url.toString(), { headers: authorization(accessToken) })
		)
	);
	if (
		!body ||
		!exactKeys(body, ['startPageToken', 'kind']) ||
		typeof body.startPageToken !== 'string' ||
		body.startPageToken.length < 1 ||
		body.startPageToken.length > 4096
	) {
		throw new TypeError('Invalid Google Drive start page token response');
	}
	return body.startPageToken;
}

function escapeQueryLiteral(value: string): string {
	return validName(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

export async function bootstrapDriveRoot({
	accessToken,
	rootFolderName,
	fetchImpl = fetch
}: {
	accessToken: string;
	rootFolderName: string;
	fetchImpl?: FetchLike;
}): Promise<Readonly<{ rootFolder: GoogleDriveFolder; startPageToken: string }>> {
	const name = validName(rootFolderName);
	const folders = await listDriveFolders({
		accessToken,
		query: `name = '${escapeQueryLiteral(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
		fetchImpl
	});
	if (folders.length > 1) throw new Error('Ambiguous Google Drive root folder');
	const rootFolder = folders[0] ?? (await createDriveFolder({ accessToken, name, fetchImpl }));
	const startPageToken = await getDriveStartPageToken({ accessToken, fetchImpl });
	return Object.freeze({ rootFolder, startPageToken });
}
