import {
	requestDriveAccessToken,
	type BrowserFetchLike,
	type DriveTokenClientLike
} from './browser-upload';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MARKER_PURPOSE = 'ficharioPurpose';
const MARKER_DOCUMENT_ID = 'ficharioDocumentId';

function validateFileId(fileId: string) {
	if (!DRIVE_ID.test(fileId)) throw new TypeError('Invalid Google Drive file identifier');
	return fileId;
}

function parseClearedMarkerResponse(value: unknown, expectedFileId: string) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('invalid marker response');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (
		(keys.length !== 1 && keys.length !== 2) ||
		!keys.every((key) => key === 'id' || key === 'appProperties') ||
		record.id !== expectedFileId
	) {
		throw new Error('invalid marker response');
	}
	if (record.appProperties === undefined) return;
	if (
		record.appProperties === null ||
		typeof record.appProperties !== 'object' ||
		Array.isArray(record.appProperties)
	) {
		throw new Error('invalid marker response');
	}
	const properties = record.appProperties as Record<string, unknown>;
	if (
		(properties[MARKER_PURPOSE] !== undefined && properties[MARKER_PURPOSE] !== null) ||
		(properties[MARKER_DOCUMENT_ID] !== undefined && properties[MARKER_DOCUMENT_ID] !== null)
	) {
		throw new Error('managed marker still present');
	}
}

export async function clearBrowserDrivePdfReferenceMarker({
	client,
	fileId,
	fetchImpl = fetch
}: {
	client: DriveTokenClientLike;
	fileId: string;
	fetchImpl?: BrowserFetchLike;
}): Promise<void> {
	const safeFileId = validateFileId(fileId);
	try {
		const access = await requestDriveAccessToken(client);
		const url = new URL(`https://www.googleapis.com/drive/v3/files/${safeFileId}`);
		url.searchParams.set('fields', 'id,appProperties');
		const response = await fetchImpl(url.toString(), {
			method: 'PATCH',
			redirect: 'error',
			cache: 'no-store',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${access.accessToken}`,
				'Content-Type': 'application/json; charset=UTF-8'
			},
			body: JSON.stringify({
				appProperties: {
					[MARKER_PURPOSE]: null,
					[MARKER_DOCUMENT_ID]: null
				}
			})
		});
		if (!response.ok) throw new Error('marker update failed');
		const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
		if (!contentType.includes('application/json')) throw new Error('marker update failed');
		parseClearedMarkerResponse(await response.json(), safeFileId);
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível limpar o marcador da cópia gerenciada no Google Drive.');
	}
}
