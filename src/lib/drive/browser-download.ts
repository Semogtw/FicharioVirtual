const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const DRIVE_MEDIA_CHUNK_BYTES = 1024 * 1024;

export type DriveMediaClientLike = {
	functions: {
		invoke(
			name: 'drive-media',
			options: { body: Record<string, unknown> }
		): Promise<{ data: unknown; error: unknown }>;
	};
};

type DriveMediaMetadata = Readonly<{ size: number; mimeType: string }>;

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

function parseMetadata(value: unknown): DriveMediaMetadata {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('invalid metadata');
	}
	const record = value as Record<string, unknown>;
	if (
		!Object.keys(record).every((key) => key === 'size' || key === 'mimeType') ||
		!Number.isSafeInteger(record.size) ||
		(record.size as number) < 1 ||
		typeof record.mimeType !== 'string' ||
		record.mimeType.length > 256
	) {
		throw new Error('invalid metadata');
	}
	return Object.freeze({ size: record.size as number, mimeType: record.mimeType });
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
		const metadata = parseMetadata(
			await invokeDriveMedia(client, { operation: 'metadata', fileId: safeFileId })
		);
		if (metadata.size > safeMaximumBytes) {
			throw new RangeError('O arquivo selecionado no Google Drive é grande demais.');
		}
		const chunks: Blob[] = [];
		for (let start = 0; start < metadata.size; start += DRIVE_MEDIA_CHUNK_BYTES) {
			const endExclusive = Math.min(metadata.size, start + DRIVE_MEDIA_CHUNK_BYTES);
			chunks.push(
				await readDriveMediaRange({
					client,
					fileId: safeFileId,
					start,
					endExclusive,
					totalBytes: metadata.size
				})
			);
		}
		return new Blob(chunks, { type: metadata.mimeType });
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
