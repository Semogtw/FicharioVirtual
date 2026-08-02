import type { SupabaseClient } from '@supabase/supabase-js';
import type { PreparedImage } from './image-types';
import { calculateSha256 } from './hash';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from '$lib/services/supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Waiter = {
	resolve: () => void;
	reject: (reason: unknown) => void;
	signal?: AbortSignal;
	onAbort: () => void;
};

class Semaphore {
	readonly #limit: number;
	readonly #waiters: Waiter[] = [];
	#active = 0;

	constructor(limit: number) {
		this.#limit = limit;
	}

	async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		await this.#acquire(signal);
		try {
			if (signal?.aborted) throw abortError();
			return await operation();
		} finally {
			this.#release();
		}
	}

	#acquire(signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) return Promise.reject(abortError());
		if (this.#active < this.#limit) {
			this.#active += 1;
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			const waiter: Waiter = {
				resolve: () => {
					signal?.removeEventListener('abort', waiter.onAbort);
					this.#active += 1;
					resolve();
				},
				reject,
				signal,
				onAbort: () => {
					const index = this.#waiters.indexOf(waiter);
					if (index >= 0) this.#waiters.splice(index, 1);
					reject(abortError());
				}
			};
			signal?.addEventListener('abort', waiter.onAbort, { once: true });
			this.#waiters.push(waiter);
		});
	}

	#release() {
		this.#active = Math.max(0, this.#active - 1);
		const next = this.#waiters.shift();
		next?.resolve();
	}
}

const uploadSlots = new Semaphore(3);

export type UploadPreparedImageInput = {
	prepared: PreparedImage;
	title?: string;
	notebookId?: string | null;
	sourceCreatedAt?: string | null;
	promptVersion?: number;
	signal?: AbortSignal;
};

export type UploadedPage = {
	documentId: string;
	pageId: string;
	ocrJobId: string;
	sha256: string;
	storagePath: string;
	thumbnailPath: string;
};

export class DuplicateImageError extends Error {
	readonly documentId: string;

	constructor(documentId: string) {
		super('Esta imagem já está no fichário.');
		this.name = 'DuplicateImageError';
		this.documentId = documentId;
	}
}

export class ImageUploadError extends Error {
	readonly code:
		| 'not_authenticated'
		| 'duplicate_check_failed'
		| 'upload_failed'
		| 'metadata_failed';

	constructor(code: ImageUploadError['code']) {
		const messages = {
			not_authenticated: 'Entre novamente antes de enviar arquivos.',
			duplicate_check_failed: 'Não foi possível verificar se a imagem já existe.',
			upload_failed: 'Não foi possível enviar a imagem agora.',
			metadata_failed: 'A imagem foi enviada, mas o registro não pôde ser concluído.'
		} as const;
		super(messages[code]);
		this.name = 'ImageUploadError';
		this.code = code;
	}
}

function abortError() {
	return new DOMException('Image upload was cancelled', 'AbortError');
}

function requireUuid(value: string | null | undefined, label: string) {
	if (value !== null && value !== undefined && !UUID.test(value)) {
		throw new TypeError(`Invalid ${label}`);
	}
	return value ?? null;
}

function uuid() {
	const value = globalThis.crypto?.randomUUID?.();
	if (!value) throw new Error('Secure UUID generation is unavailable');
	return value;
}

function extension(blob: Blob) {
	return blob.type === 'image/webp' ? 'webp' : 'jpg';
}

function defaultTitle(filename: string) {
	const value = filename.replace(/\.[^.]+$/, '').trim();
	return value.slice(0, 240) || 'Imagem sem título';
}

async function removeUploaded(
	client: SupabaseClient<Database>,
	paths: readonly string[]
): Promise<void> {
	try {
		await client.storage.from('documents').remove([...paths]);
	} catch {
		// A later cleanup pass can retry removal; do not mask the primary error.
	}
}

export async function uploadPreparedImage(
	input: UploadPreparedImageInput,
	client: SupabaseClient<Database> = getSupabaseClient()
): Promise<UploadedPage> {
	return uploadSlots.run(async () => {
		const signal = input.signal;
		if (signal?.aborted) throw abortError();
		const notebookId = requireUuid(input.notebookId, 'notebook identifier');
		const promptVersion = input.promptVersion ?? 1;
		if (!Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
			throw new TypeError('Invalid OCR prompt version');
		}

		const { data: sessionData, error: sessionError } = await client.auth.getSession();
		if (sessionError || sessionData.session === null) {
			throw new ImageUploadError('not_authenticated');
		}
		const userId = sessionData.session.user.id;
		const sha256 = await calculateSha256(input.prepared.image);
		if (signal?.aborted) throw abortError();

		const { data: duplicate, error: duplicateError } = await client
			.from('documents')
			.select('id')
			.eq('sha256', sha256)
			.maybeSingle();
		if (duplicateError) throw new ImageUploadError('duplicate_check_failed');
		if (duplicate) throw new DuplicateImageError(duplicate.id);

		const documentId = uuid();
		const pageId = uuid();
		const ocrJobId = uuid();
		const root = `${userId}/${documentId}`;
		const storagePath = `${root}/original.${extension(input.prepared.image)}`;
		const thumbnailPath = `${root}/thumbnail.${extension(input.prepared.thumbnail)}`;
		const bucket = client.storage.from('documents');

		const [originalUpload, thumbnailUpload] = await Promise.all([
			bucket.upload(storagePath, input.prepared.image, {
				contentType: input.prepared.image.type,
				cacheControl: '3600',
				upsert: false
			}),
			bucket.upload(thumbnailPath, input.prepared.thumbnail, {
				contentType: input.prepared.thumbnail.type,
				cacheControl: '86400',
				upsert: false
			})
		]);
		if (originalUpload.error || thumbnailUpload.error) {
			await removeUploaded(client, [storagePath, thumbnailPath]);
			throw new ImageUploadError('upload_failed');
		}
		if (signal?.aborted) {
			await removeUploaded(client, [storagePath, thumbnailPath]);
			throw abortError();
		}

		type RpcClient = {
			rpc(
				name: 'create_image_import',
				args: Record<string, unknown>
			): Promise<{
					data: Array<{ document_id: string; page_id: string; ocr_job_id: string }> | null;
					error: unknown;
				}>;
		};
		const { data, error } = await (client as unknown as RpcClient).rpc('create_image_import', {
			target_document_id: documentId,
			target_page_id: pageId,
			target_job_id: ocrJobId,
			target_notebook_id: notebookId,
			document_title: input.title?.trim() || defaultTitle(input.prepared.originalName),
			original_filename: input.prepared.originalName,
			original_storage_path: storagePath,
			thumbnail_storage_path: thumbnailPath,
			prepared_sha256: sha256,
			source_created_at: input.sourceCreatedAt ?? null,
			prompt_version: promptVersion
		});
		const terminal = data?.[0];
		if (error || !terminal) {
			await removeUploaded(client, [storagePath, thumbnailPath]);
			throw new ImageUploadError('metadata_failed');
		}

		return Object.freeze({
			documentId: terminal.document_id,
			pageId: terminal.page_id,
			ocrJobId: terminal.ocr_job_id,
			sha256,
			storagePath,
			thumbnailPath
		});
	}, input.signal);
}
