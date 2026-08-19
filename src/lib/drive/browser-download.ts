const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;

export type DriveMediaClientLike = {
	functions: {
		invoke(
			name: 'drive-media',
			options: { body: Record<string, unknown> }
		): Promise<{ data: unknown; error: unknown }>;
	};
};

function validDriveId(value: string): string {
	if (!DRIVE_ID.test(value)) throw new TypeError('Invalid Google Drive file identifier');
	return value;
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

async function invokeDriveMedia(
	client: DriveMediaClientLike,
	body: Record<string, unknown>
): Promise<unknown> {
	const { data, error } = await client.functions.invoke('drive-media', { body });
	if (error) throw new Error('drive media request failed');
	return data;
}

async function readDriveMediaRange({
	client,
	fileId,
	start,
	endExclusive,
	totalBytes
}: {
	client: DriveMediaClientLike;
	fileId: string;
	start: number;
	endExclusive: number;
	totalBytes: number;
}): Promise<Blob> {
	const data = await invokeDriveMedia(client, {
		operation: 'read',
		fileId,
		start,
		endExclusive,
		totalBytes
	});
	if (!(data instanceof Blob) || data.size !== endExclusive - start) {
		throw new Error('invalid drive media response');
	}
	return data;
}

export async function downloadBrowserDriveFile({
	client,
	fileId,
	maximumBytes
}: {
	client: DriveMediaClientLike;
	fileId: string;
	maximumBytes: number;
}): Promise<Blob> {
	const safeFileId = validDriveId(fileId);
	const safeMaximumBytes = validMaximumBytes(maximumBytes);
	try {
		const data = await invokeDriveMedia(client, {
			operation: 'download',
			fileId: safeFileId,
			maximumBytes: safeMaximumBytes
		});
		if (!(data instanceof Blob) || data.size < 1 || data.size > safeMaximumBytes) {
			throw new Error('invalid drive media response');
		}
		return data;
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível baixar o arquivo selecionado no Google Drive.');
	}
}

export async function downloadBrowserDriveRange({
	client,
	fileId,
	start,
	endExclusive,
	totalBytes
}: {
	client: DriveMediaClientLike;
	fileId: string;
	start: number;
	endExclusive: number;
	totalBytes: number;
}): Promise<Blob> {
	const safeFileId = validDriveId(fileId);
	const range = validDriveDownloadRange(start, endExclusive, totalBytes);
	try {
		return await readDriveMediaRange({
			client,
			fileId: safeFileId,
			start: range.start,
			endExclusive: range.endExclusive,
			totalBytes: range.totalBytes
		});
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível baixar parte do arquivo selecionado no Google Drive.');
	}
}
