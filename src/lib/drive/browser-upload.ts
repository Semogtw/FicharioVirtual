import { z } from 'zod';
import {
	DRIVE_UPLOAD_CHUNK_ALIGNMENT,
	uploadDriveBlob,
	validateDriveUploadSessionUrl,
	type DriveResumableGateway,
	type DriveUploadResponse
} from './resumable-upload';
import type { DriveFile } from './types';

export type DriveTokenClientLike = {
	functions: {
		invoke(
			name: 'drive-access-token',
			options: { body: Record<string, never> }
		): Promise<{ data: unknown; error: unknown }>;
	};
};

export type BrowserFetchLike = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const DRIVE_TOKEN_RETRY_DELAY_MS = 150;
const tokenSchema = z
	.object({
		accessToken: z.string().min(8).max(8192),
		expiresAt: z.iso.datetime({ offset: true })
	})
	.strict();

export interface EphemeralDriveAccess {
	accessToken: string;
	expiresAt: string;
}

function validAccessToken(value: string): string {
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
		throw new TypeError('Invalid Google Drive upload metadata');
	}
	return normalized;
}

function validMimeType(value: string): string {
	const normalized = value.trim();
	if (
		normalized.length < 1 ||
		normalized.length > 256 ||
		!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(normalized)
	) {
		throw new TypeError('Invalid Google Drive upload metadata');
	}
	return normalized;
}

function validParentFolderId(value: string): string {
	if (!DRIVE_ID.test(value)) throw new TypeError('Invalid Google Drive upload metadata');
	return value;
}

function validTotalBytes(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError('Invalid Google Drive upload metadata');
	}
	return value;
}

async function strictResponseBody(response: Response): Promise<unknown> {
	if (response.status !== 200 && response.status !== 201) return null;
	const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
	if (!contentType.includes('application/json')) {
		throw new Error('Invalid Google Drive upload response');
	}
	try {
		return await response.json();
	} catch {
		throw new Error('Invalid Google Drive upload response');
	}
}

function authorizationHeaders(accessToken: string) {
	return { Authorization: `Bearer ${validAccessToken(accessToken)}` };
}

function retryableTokenFunctionError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return true;
	const context = (error as { context?: unknown }).context;
	if (!(context instanceof Response)) return true;
	return (
		context.status === 408 ||
		context.status === 425 ||
		context.status === 429 ||
		context.status >= 500
	);
}

function waitForTokenRetry() {
	return new Promise<void>((resolve) => setTimeout(resolve, DRIVE_TOKEN_RETRY_DELAY_MS));
}

export async function requestDriveAccessToken(
	client: DriveTokenClientLike
): Promise<Readonly<EphemeralDriveAccess>> {
	try {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			let result: { data: unknown; error: unknown };
			try {
				result = await client.functions.invoke('drive-access-token', { body: {} });
			} catch (error) {
				if (attempt === 0) {
					await waitForTokenRetry();
					continue;
				}
				throw error;
			}

			if (result.error) {
				if (attempt === 0 && retryableTokenFunctionError(result.error)) {
					await waitForTokenRetry();
					continue;
				}
				throw result.error;
			}

			const parsed = tokenSchema.parse(result.data);
			validAccessToken(parsed.accessToken);
			return Object.freeze(parsed);
		}
		throw new Error('Drive token attempts exhausted');
	} catch {
		throw new Error('Não foi possível obter acesso temporário ao Google Drive.');
	}
}

export async function createDriveResumableSession({
	accessToken,
	name,
	mimeType,
	parentFolderId,
	totalBytes,
	fetchImpl = fetch
}: {
	accessToken: string;
	name: string;
	mimeType: string;
	parentFolderId: string;
	totalBytes: number;
	fetchImpl?: BrowserFetchLike;
}): Promise<string> {
	try {
		const safeName = validName(name);
		const safeMimeType = validMimeType(mimeType);
		const safeParentFolderId = validParentFolderId(parentFolderId);
		const safeTotalBytes = validTotalBytes(totalBytes);
		const url = new URL('https://www.googleapis.com/upload/drive/v3/files');
		url.searchParams.set('uploadType', 'resumable');
		url.searchParams.set(
			'fields',
			'id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed'
		);
		const response = await fetchImpl(url.toString(), {
			method: 'POST',
			redirect: 'error',
			headers: {
				Accept: 'application/json',
				...authorizationHeaders(accessToken),
				'Content-Type': 'application/json; charset=UTF-8',
				'X-Upload-Content-Length': String(safeTotalBytes),
				'X-Upload-Content-Type': safeMimeType
			},
			body: JSON.stringify({
				name: safeName,
				mimeType: safeMimeType,
				parents: [safeParentFolderId]
			})
		});
		if (response.status !== 200 && response.status !== 201) throw new Error('session failed');
		const location = response.headers.get('Location');
		if (!location) throw new Error('session missing');
		return validateDriveUploadSessionUrl(location);
	} catch {
		throw new Error('Não foi possível iniciar o upload no Google Drive.');
	}
}

export function createBrowserDriveUploadGateway({
	accessToken,
	fetchImpl = fetch
}: {
	accessToken: string;
	fetchImpl?: BrowserFetchLike;
}): DriveResumableGateway {
	const headers = authorizationHeaders(accessToken);

	async function responseResult(response: Response): Promise<DriveUploadResponse> {
		return Object.freeze({
			status: response.status,
			range: response.headers.get('Range'),
			body: await strictResponseBody(response)
		});
	}

	return Object.freeze({
		async uploadChunk({
			sessionUrl,
			body,
			contentRange
		}: Parameters<DriveResumableGateway['uploadChunk']>[0]) {
			const response = await fetchImpl(validateDriveUploadSessionUrl(sessionUrl), {
				method: 'PUT',
				redirect: 'error',
				headers: {
					...headers,
					'Content-Range': contentRange
				},
				body
			});
			return responseResult(response);
		},
		async queryProgress({
			sessionUrl,
			totalBytes
		}: Parameters<DriveResumableGateway['queryProgress']>[0]) {
			const response = await fetchImpl(validateDriveUploadSessionUrl(sessionUrl), {
				method: 'PUT',
				redirect: 'error',
				headers: {
					...headers,
					'Content-Range': `bytes */${validTotalBytes(totalBytes)}`
				}
			});
			return responseResult(response);
		}
	});
}

export async function uploadBrowserBlobToDrive({
	client,
	blob,
	name,
	parentFolderId,
	chunkSize = DRIVE_UPLOAD_CHUNK_ALIGNMENT,
	fetchImpl = fetch
}: {
	client: DriveTokenClientLike;
	blob: Blob;
	name: string;
	parentFolderId: string;
	chunkSize?: number;
	fetchImpl?: BrowserFetchLike;
}): Promise<DriveFile> {
	if (!(blob instanceof Blob) || blob.size <= 0) {
		throw new TypeError('Invalid Google Drive upload body');
	}
	const access = await requestDriveAccessToken(client);
	const mimeType = validMimeType(blob.type || 'application/octet-stream');
	const sessionUrl = await createDriveResumableSession({
		accessToken: access.accessToken,
		name,
		mimeType,
		parentFolderId,
		totalBytes: blob.size,
		fetchImpl
	});
	return uploadDriveBlob({
		blob,
		sessionUrl,
		chunkSize,
		gateway: createBrowserDriveUploadGateway({ accessToken: access.accessToken, fetchImpl })
	});
}
