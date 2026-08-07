import { parseDriveFile } from './contracts';
import {
	requestDriveAccessToken,
	type BrowserFetchLike,
	type DriveTokenClientLike
} from './browser-upload';
import type { DriveFile } from './types';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_PROPERTY_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed';
const MANAGED_REFERENCE_QUERY =
	"appProperties has { key='ficharioPurpose' and value='oversized_pdf_reference' } and trashed = false";
const MANAGED_REFERENCE_FIELDS =
	'nextPageToken,files(id,name,mimeType,parents,createdTime,trashed,appProperties)';
const MAX_MANAGED_REFERENCE_PAGES = 100;

export type BrowserDrivePdfReferenceCopy = Readonly<{
	fileId: string;
	documentId: string;
	parentFolderId: string;
	createdAt: string;
}>;

function validDriveId(value: string): string {
	if (!DRIVE_ID.test(value)) throw new TypeError('Invalid Google Drive file identifier');
	return value;
}

function validName(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim();
	if (
		normalized.length < 1 ||
		normalized.length > 512 ||
		[...normalized].some((character) => {
			const code = character.codePointAt(0);
			return code !== undefined && (code < 32 || code === 127);
		})
	) {
		throw new TypeError('Invalid Google Drive file name');
	}
	return normalized;
}

function validAppProperties(
	value: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> | undefined {
	if (value === undefined) return undefined;
	const entries = Object.entries(value);
	if (entries.length < 1 || entries.length > 30) {
		throw new TypeError('Invalid Google Drive app properties');
	}
	const encoder = new TextEncoder();
	const normalized: Record<string, string> = {};
	for (const [key, rawValue] of entries) {
		if (!APP_PROPERTY_KEY.test(key) || typeof rawValue !== 'string') {
			throw new TypeError('Invalid Google Drive app properties');
		}
		const safeValue = rawValue.trim();
		if (
			safeValue.length < 1 ||
			[...safeValue].some((character) => {
				const code = character.codePointAt(0);
				return code !== undefined && (code < 32 || code === 127);
			}) ||
			encoder.encode(key).byteLength + encoder.encode(safeValue).byteLength > 124
		) {
			throw new TypeError('Invalid Google Drive app properties');
		}
		normalized[key] = safeValue;
	}
	return Object.freeze(normalized);
}

function authorization(accessToken: string) {
	return { Authorization: `Bearer ${accessToken}` };
}

async function strictJson(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error('Google Drive file request failed');
	const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
	if (!contentType.includes('application/json'))
		throw new Error('Google Drive file request failed');
	try {
		return await response.json();
	} catch {
		throw new Error('Google Drive file request failed');
	}
}

function normalizedIsoTimestamp(value: unknown): string | null {
	if (typeof value !== 'string' || value.length < 10 || value.length > 64) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function validPageToken(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.length < 1 || value.length > 2048) {
		throw new Error('Google Drive managed reference response failed');
	}
	return value;
}

function parseManagedReferencePage(value: unknown): {
	files: BrowserDrivePdfReferenceCopy[];
	nextPageToken: string | null;
} {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Google Drive managed reference response failed');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (
		!keys.every((key) => key === 'files' || key === 'nextPageToken') ||
		!Array.isArray(record.files)
	) {
		throw new Error('Google Drive managed reference response failed');
	}
	const files = record.files.map((entry): BrowserDrivePdfReferenceCopy => {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new Error('Google Drive managed reference response failed');
		}
		const file = entry as Record<string, unknown>;
		const fileKeys = Object.keys(file).sort();
		const expectedKeys = [
			'appProperties',
			'createdTime',
			'id',
			'mimeType',
			'name',
			'parents',
			'trashed'
		];
		if (
			fileKeys.length !== expectedKeys.length ||
			!fileKeys.every((key, index) => key === expectedKeys[index]) ||
			!DRIVE_ID.test(String(file.id ?? '')) ||
			file.mimeType !== 'application/pdf' ||
			file.trashed !== false ||
			!Array.isArray(file.parents) ||
			file.parents.length !== 1 ||
			!DRIVE_ID.test(String(file.parents[0] ?? '')) ||
			typeof file.name !== 'string' ||
			validName(file.name) === undefined ||
			file.appProperties === null ||
			typeof file.appProperties !== 'object' ||
			Array.isArray(file.appProperties)
		) {
			throw new Error('Google Drive managed reference response failed');
		}
		const properties = file.appProperties as Record<string, unknown>;
		const createdAt = normalizedIsoTimestamp(file.createdTime);
		if (
			properties.ficharioPurpose !== 'oversized_pdf_reference' ||
			typeof properties.ficharioDocumentId !== 'string' ||
			!UUID.test(properties.ficharioDocumentId) ||
			createdAt === null
		) {
			throw new Error('Google Drive managed reference response failed');
		}
		return Object.freeze({
			fileId: String(file.id),
			documentId: properties.ficharioDocumentId,
			parentFolderId: String(file.parents[0]),
			createdAt
		});
	});
	return { files, nextPageToken: validPageToken(record.nextPageToken) };
}

export async function copyBrowserDriveFile({
	client,
	sourceFileId,
	parentFolderId,
	name,
	appProperties,
	fetchImpl = fetch
}: {
	client: DriveTokenClientLike;
	sourceFileId: string;
	parentFolderId: string;
	name?: string;
	appProperties?: Readonly<Record<string, string>>;
	fetchImpl?: BrowserFetchLike;
}): Promise<DriveFile> {
	const sourceId = validDriveId(sourceFileId);
	const parentId = validDriveId(parentFolderId);
	const safeName = validName(name);
	const safeProperties = validAppProperties(appProperties);
	try {
		const access = await requestDriveAccessToken(client);
		const url = new URL(`https://www.googleapis.com/drive/v3/files/${sourceId}/copy`);
		url.searchParams.set('fields', FILE_FIELDS);
		const response = await fetchImpl(url.toString(), {
			method: 'POST',
			redirect: 'error',
			headers: {
				Accept: 'application/json',
				...authorization(access.accessToken),
				'Content-Type': 'application/json; charset=UTF-8'
			},
			body: JSON.stringify({
				...(safeName === undefined ? {} : { name: safeName }),
				parents: [parentId],
				...(safeProperties === undefined ? {} : { appProperties: safeProperties })
			})
		});
		return parseDriveFile(await strictJson(response));
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível copiar o arquivo no Google Drive.');
	}
}

export async function listBrowserDrivePdfReferenceCopies({
	client,
	fetchImpl = fetch
}: {
	client: DriveTokenClientLike;
	fetchImpl?: BrowserFetchLike;
}): Promise<readonly BrowserDrivePdfReferenceCopy[]> {
	try {
		const access = await requestDriveAccessToken(client);
		const collected: BrowserDrivePdfReferenceCopy[] = [];
		const seenTokens = new Set<string>();
		let pageToken: string | null = null;
		for (let page = 0; page < MAX_MANAGED_REFERENCE_PAGES; page += 1) {
			const url = new URL('https://www.googleapis.com/drive/v3/files');
			url.searchParams.set('q', MANAGED_REFERENCE_QUERY);
			url.searchParams.set('spaces', 'drive');
			url.searchParams.set('pageSize', '100');
			url.searchParams.set('fields', MANAGED_REFERENCE_FIELDS);
			if (pageToken !== null) url.searchParams.set('pageToken', pageToken);
			const response = await fetchImpl(url.toString(), {
				redirect: 'error',
				cache: 'no-store',
				headers: { Accept: 'application/json', ...authorization(access.accessToken) }
			});
			const parsed = parseManagedReferencePage(await strictJson(response));
			collected.push(...parsed.files);
			if (parsed.nextPageToken === null) return Object.freeze(collected);
			if (seenTokens.has(parsed.nextPageToken)) {
				throw new Error('Google Drive managed reference response failed');
			}
			seenTokens.add(parsed.nextPageToken);
			pageToken = parsed.nextPageToken;
		}
		throw new Error('Google Drive managed reference response failed');
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível listar cópias gerenciadas de PDFs no Google Drive.');
	}
}

export async function downloadBrowserDriveFile({
	client,
	fileId,
	maximumBytes,
	fetchImpl = fetch
}: {
	client: DriveTokenClientLike;
	fileId: string;
	maximumBytes: number;
	fetchImpl?: BrowserFetchLike;
}): Promise<Blob> {
	const safeFileId = validDriveId(fileId);
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
		throw new TypeError('Invalid Google Drive download limit');
	}
	try {
		const access = await requestDriveAccessToken(client);
		const url = new URL(`https://www.googleapis.com/drive/v3/files/${safeFileId}`);
		url.searchParams.set('alt', 'media');
		const response = await fetchImpl(url.toString(), {
			redirect: 'error',
			headers: authorization(access.accessToken)
		});
		if (!response.ok) throw new Error('download failed');
		const declaredLength = response.headers.get('Content-Length');
		if (declaredLength !== null) {
			const parsedLength = Number(declaredLength);
			if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) throw new Error('bad length');
			if (parsedLength > maximumBytes) {
				throw new RangeError('O arquivo selecionado no Google Drive é grande demais.');
			}
		}
		const blob = await response.blob();
		if (blob.size > maximumBytes) {
			throw new RangeError('O arquivo selecionado no Google Drive é grande demais.');
		}
		if (blob.size < 1 || blob.type.length < 1 || blob.type.length > 256) {
			throw new Error('invalid download');
		}
		return blob;
	} catch (error) {
		if (error instanceof RangeError) throw error;
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível baixar o arquivo selecionado no Google Drive.');
	}
}

function validDriveDownloadRange(start: number, endExclusive: number, totalBytes: number) {
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(endExclusive) ||
		!Number.isSafeInteger(totalBytes) ||
		start < 0 ||
		endExclusive <= start ||
		endExclusive > totalBytes
	) {
		throw new TypeError('Invalid Google Drive download range');
	}
	return Object.freeze({ start, endExclusive, totalBytes });
}

export async function downloadBrowserDriveRange({
	client,
	fileId,
	start,
	endExclusive,
	totalBytes,
	fetchImpl = fetch
}: {
	client: DriveTokenClientLike;
	fileId: string;
	start: number;
	endExclusive: number;
	totalBytes: number;
	fetchImpl?: BrowserFetchLike;
}): Promise<Blob> {
	const safeFileId = validDriveId(fileId);
	const range = validDriveDownloadRange(start, endExclusive, totalBytes);
	const lastByte = range.endExclusive - 1;
	const expectedLength = range.endExclusive - range.start;
	const expectedContentRange = `bytes ${range.start}-${lastByte}/${range.totalBytes}`;
	try {
		const access = await requestDriveAccessToken(client);
		const url = new URL(`https://www.googleapis.com/drive/v3/files/${safeFileId}`);
		url.searchParams.set('alt', 'media');
		const response = await fetchImpl(url.toString(), {
			redirect: 'error',
			cache: 'no-store',
			headers: {
				...authorization(access.accessToken),
				Range: `bytes=${range.start}-${lastByte}`
			}
		});
		if (response.status !== 206) throw new Error('partial download required');
		if (response.headers.get('Content-Range') !== expectedContentRange) {
			throw new Error('invalid content range');
		}
		const declaredLength = response.headers.get('Content-Length');
		if (declaredLength !== null && Number(declaredLength) !== expectedLength) {
			throw new Error('invalid partial length');
		}
		const blob = await response.blob();
		if (blob.size !== expectedLength || blob.type.length < 1 || blob.type.length > 256) {
			throw new Error('invalid partial download');
		}
		return blob;
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível baixar parte do arquivo selecionado no Google Drive.');
	}
}

export async function deleteBrowserDriveFile({
	client,
	fileId,
	fetchImpl = fetch
}: {
	client: DriveTokenClientLike;
	fileId: string;
	fetchImpl?: BrowserFetchLike;
}): Promise<void> {
	const safeFileId = validDriveId(fileId);
	try {
		const access = await requestDriveAccessToken(client);
		const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${safeFileId}`, {
			method: 'DELETE',
			redirect: 'error',
			headers: authorization(access.accessToken)
		});
		if (response.status !== 204 && response.status !== 404) throw new Error('delete failed');
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível remover o arquivo temporário do Google Drive.');
	}
}
