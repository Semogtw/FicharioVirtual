import {
	requestDriveAccessToken,
	type BrowserFetchLike,
	type DriveTokenClientLike
} from './browser-upload';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;

function validDriveId(value: string): string {
	if (!DRIVE_ID.test(value)) throw new TypeError('Invalid Google Drive file identifier');
	return value;
}

function authorization(accessToken: string) {
	return { Authorization: `Bearer ${accessToken}` };
}

function validMaximumBytes(value: number) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError('Invalid Google Drive download limit');
	}
	return value;
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
	const safeMaximumBytes = validMaximumBytes(maximumBytes);
	try {
		const access = await requestDriveAccessToken(client);
		const url = new URL(`https://www.googleapis.com/drive/v3/files/${safeFileId}`);
		url.searchParams.set('alt', 'media');
		const response = await fetchImpl(url.toString(), {
			cache: 'no-store',
			headers: authorization(access.accessToken)
		});
		if (!response.ok) throw new Error('download failed');
		const declaredLength = response.headers.get('Content-Length');
		if (declaredLength !== null) {
			const parsedLength = Number(declaredLength);
			if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) throw new Error('bad length');
			if (parsedLength > safeMaximumBytes) {
				throw new RangeError('O arquivo selecionado no Google Drive é grande demais.');
			}
		}
		const blob = await response.blob();
		if (blob.size > safeMaximumBytes) {
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
