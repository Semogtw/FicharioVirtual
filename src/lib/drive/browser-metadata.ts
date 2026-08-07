import { parseDriveFile } from './contracts';
import {
	requestDriveAccessToken,
	type BrowserFetchLike,
	type DriveTokenClientLike
} from './browser-upload';
import type { DriveFile } from './types';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed';

function validDriveId(value: string) {
	if (!DRIVE_ID.test(value)) throw new TypeError('Invalid Google Drive file identifier');
	return value;
}

export async function getBrowserDriveFileMetadata({
	client,
	fileId,
	fetchImpl = fetch
}: {
	client: DriveTokenClientLike;
	fileId: string;
	fetchImpl?: BrowserFetchLike;
}): Promise<DriveFile> {
	const safeFileId = validDriveId(fileId);
	try {
		const access = await requestDriveAccessToken(client);
		const url = new URL(`https://www.googleapis.com/drive/v3/files/${safeFileId}`);
		url.searchParams.set('fields', FILE_FIELDS);
		const response = await fetchImpl(url.toString(), {
			cache: 'no-store',
			redirect: 'error',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${access.accessToken}`
			}
		});
		if (!response.ok) throw new Error('metadata request failed');
		if (!(response.headers.get('Content-Type') ?? '').toLowerCase().includes('application/json')) {
			throw new Error('metadata response type failed');
		}
		return parseDriveFile(await response.json());
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível verificar o arquivo preservado no Google Drive.');
	}
}
