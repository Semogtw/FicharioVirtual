import { parseDriveFile } from './contracts';
import {
	requestDriveAccessToken,
	type BrowserFetchLike,
	type DriveTokenClientLike
} from './browser-upload';
import type { DriveFile } from './types';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed';

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

function authorization(accessToken: string) {
	return { Authorization: `Bearer ${accessToken}` };
}

async function strictJson(response: Response): Promise<unknown> {
	if (!response.ok) throw new Error('Google Drive file request failed');
	const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
	if (!contentType.includes('application/json')) throw new Error('Google Drive file request failed');
	try {
		return await response.json();
	} catch {
		throw new Error('Google Drive file request failed');
	}
}

export async function copyBrowserDriveFile({
	client,
	sourceFileId,
	parentFolderId,
	name,
	fetchImpl = fetch
}: {
	client: DriveTokenClientLike;
	sourceFileId: string;
	parentFolderId: string;
	name?: string;
	fetchImpl?: BrowserFetchLike;
}): Promise<DriveFile> {
	const sourceId = validDriveId(sourceFileId);
	const parentId = validDriveId(parentFolderId);
	const safeName = validName(name);
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
				parents: [parentId]
			})
		});
		return parseDriveFile(await strictJson(response));
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível copiar o arquivo no Google Drive.');
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
