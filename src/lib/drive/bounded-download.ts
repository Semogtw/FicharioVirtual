import {
	requestDriveAccessToken,
	type BrowserFetchLike,
	type DriveTokenClientLike
} from './browser-upload';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MAX_CONTENT_TYPE_BYTES = 256;

function validDriveId(value: string) {
	if (!DRIVE_ID.test(value)) throw new TypeError('Invalid Google Drive file identifier');
	return value;
}

function validMaximumBytes(value: number) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError('Invalid Google Drive download limit');
	}
	return value;
}

function responseMimeType(response: Response) {
	const raw = response.headers.get('Content-Type')?.trim() ?? '';
	if (raw.length < 1 || new TextEncoder().encode(raw).byteLength > MAX_CONTENT_TYPE_BYTES) {
		throw new Error('invalid download');
	}
	const mimeType = raw.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)) {
		throw new Error('invalid download');
	}
	return mimeType;
}

function validateDeclaredLength(response: Response, maximumBytes: number) {
	const raw = response.headers.get('Content-Length');
	if (raw === null) return;
	if (!/^\d{1,12}$/.test(raw)) throw new Error('bad length');
	const length = Number(raw);
	if (!Number.isSafeInteger(length) || length < 0) throw new Error('bad length');
	if (length > maximumBytes) {
		throw new RangeError('O arquivo selecionado no Google Drive é grande demais.');
	}
}

async function boundedBlob(response: Response, maximumBytes: number) {
	const mimeType = responseMimeType(response);
	validateDeclaredLength(response, maximumBytes);
	if (!response.body) throw new Error('download failed');

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array)) throw new Error('invalid download');
			total += value.byteLength;
			if (total > maximumBytes) {
				value.fill(0);
				await reader.cancel('download exceeds configured limit').catch(() => undefined);
				throw new RangeError('O arquivo selecionado no Google Drive é grande demais.');
			}
			chunks.push(value);
		}
		if (total < 1) throw new Error('invalid download');

		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const blob = new Blob([bytes.buffer], { type: mimeType });
		bytes.fill(0);
		for (const chunk of chunks) chunk.fill(0);
		return blob;
	} catch (error) {
		for (const chunk of chunks) chunk.fill(0);
		throw error;
	} finally {
		reader.releaseLock();
	}
}

export async function downloadBoundedBrowserDriveFile({
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
			headers: { Authorization: `Bearer ${access.accessToken}` }
		});
		if (!response.ok) throw new Error('download failed');
		return await boundedBlob(response, safeMaximumBytes);
	} catch (error) {
		if (error instanceof RangeError) throw error;
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível baixar o arquivo selecionado no Google Drive.');
	}
}
