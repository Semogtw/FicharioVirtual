import type { SupabaseClient } from '@supabase/supabase-js';
import type { PreparedImage } from './image-types';
import { calculateSha256 } from './hash';
import { parseDuplicateDocumentId } from './duplicate-result';
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

export type ImageImportIdentifiers = {
	documentId: string;
	pageId: string;
	ocrJobId: string;
};

export type UploadedPage = ImageImportIdentifiers & {
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
		'not_authenticated' | 'duplicate_check_failed' | 'upload_failed' | 'metadata_failed';

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

function sourceExtension(file: File) {
	if (file.type === 'image/png') return 'png';
	if (file.type === 'image/webp') return 'webp';
	return 'jpg';
}

function defaultTitle(filename: string) {
	const value = filename.replace(/\.[^.]+$/, '').trim();
	return value.slice(0, 240) || 'Imagem sem título';
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function invalidImageImportResult(): never {
	throw new TypeError('Invalid image import result');
}

export function parseImageImportResult(
	data: unknown,
	expected: ImageImportIdentifiers
): Readonly<ImageImportIdentifiers> {
	if (
		!UUID.test(expected.documentId) ||
		!UUID.test(expected.pageId) ||
		!UUID.test(expected.ocrJobId) ||
		!Array.isArray(data) ||
		data.length !== 1
	) {
		invalidImageImportResult();
	}
	const row = data[0];
	if (row === null || typeof row !== 'object' || Array.isArray(row)) {
		invalidImageImportResult();
	}
	const value = row as Record<string, unknown>;
	if (!hasExactKeys(value, ['document_id', 'page_id', 'ocr_job_id'])) {
		invalidImageImportResult();
	}
	const documentId = value.document_id;
	const pageId = value.page_id;
	const ocrJobId = value.ocr_job_id;
	if (
		typeof documentId !== 'string' ||
		!UUID.test(documentId) ||
		documentId !== expected.documentId ||
		typeof pageId !== 'string' ||
		!UUID.test(pageId) ||
		pageId !== expected.pageId ||
		typeof ocrJobId !== 'string' ||
		!UUID.test(ocrJobId) ||
		ocrJobId !== expected.ocrJobId
	) {
		invalidImageImportResult();
	}
	return Object.freeze({ documentId, pageId, ocrJobId });
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

export async function uploadPreparedImageToSupabase(
	input: UploadPreparedImageInput,
	client?: SupabaseClient<Database>
): Promise<UploadedPage> {
	const signal = input.signal;
	if (signal?.aborted) throw abortError();
	const notebookId = requireUuid(input.notebookId, 'notebook identifier');
	const promptVersion = input.promptVersion ?? 1;
	if (!Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
		throw new TypeError('Invalid OCR prompt version');
	}
	if (!(input.prepared.original instanceof File) || input.prepared.original.size < 1) {
		throw new TypeError('Invalid source image');
	}
	const gateway = client ?? getSupabaseClient();

	return uploadSlots.run(async () => {
		if (signal?.aborted) throw abortError();
		let sessionResult: Awaited<ReturnType<typeof gateway.auth.getSession>>;
		try {
			sessionResult = await gateway.auth.getSession();
		} catch {
			throw new ImageUploadError('not_authenticated');
		}
		const { data: sessionData, error: sessionError } = sessionResult;
		if (sessionError || sessionData.session === null) {
			throw new ImageUploadError('not_authenticated');
		}
		const userId = sessionData.session.user.id;
		const [sha256, sourceSha256] = await Promise.all([
			calculateSha256(input.prepared.image),
			calculateSha256(input.prepared.original)
		]);
		if (signal?.aborted) throw abortError();

		let duplicateResult: { data: unknown; error: unknown };
		try {
			duplicateResult = await gateway
				.from('documents')
				.select('id')
				.eq('sha256', sha256)
				.maybeSingle();
		} catch {
			throw new ImageUploadError('duplicate_check_failed');
		}
		if (duplicateResult.error) throw new ImageUploadError('duplicate_check_failed');
		let duplicateId: string | null;
		try {
			duplicateId = parseDuplicateDocumentId(duplicateResult.data);
		} catch {
			throw new ImageUploadError('duplicate_check_failed');
		}
		if (duplicateId) throw new DuplicateImageError(duplicateId);
		if (signal?.aborted) throw abortError();

		const documentId = uuid();
		const pageId = uuid();
		const ocrJobId = uuid();
		const root = `${userId}/${documentId}`;
		const storagePath = `${root}/prepared.${extension(input.prepared.image)}`;
		const sourcePath = `${root}/source.${sourceExtension(input.prepared.original)}`;
		const thumbnailPath = `${root}/thumbnail.${extension(input.prepared.thumbnail)}`;
		const uploadedPaths = [storagePath, sourcePath, thumbnailPath] as const;
		const bucket = gateway.storage.from('documents');
		let preparedUpload: { error: unknown };
		let sourceUpload: { error: unknown };
		let thumbnailUpload: { error: unknown };
		try {
			[preparedUpload, sourceUpload, thumbnailUpload] = await Promise.all([
				bucket.upload(storagePath, input.prepared.image, {
					contentType: input.prepared.image.type,
					cacheControl: '3600',
					upsert: false
				}),
				bucket.upload(sourcePath, input.prepared.original, {
					contentType: input.prepared.original.type,
					cacheControl: '3600',
					upsert: false
				}),
				bucket.upload(thumbnailPath, input.prepared.thumbnail, {
					contentType: input.prepared.thumbnail.type,
					cacheControl: '86400',
					upsert: false
				})
			]);
		} catch {
			await removeUploaded(gateway, uploadedPaths);
			throw new ImageUploadError('upload_failed');
		}
		if (preparedUpload.error || sourceUpload.error || thumbnailUpload.error) {
			await removeUploaded(gateway, uploadedPaths);
			throw new ImageUploadError('upload_failed');
		}
		if (signal?.aborted) {
			await removeUploaded(gateway, uploadedPaths);
			throw abortError();
		}

		type RpcClient = {
			rpc(
				name: 'create_image_import_v2',
				args: Record<string, unknown>
			): Promise<{ data: unknown; error: unknown }>;
		};
		const preprocessing = input.prepared.preprocessing;
		let metadataResult: { data: unknown; error: unknown };
		try {
			metadataResult = await (gateway as unknown as RpcClient).rpc('create_image_import_v2', {
				target_document_id: documentId,
				target_page_id: pageId,
				target_job_id: ocrJobId,
				target_notebook_id: notebookId,
				document_title: input.title?.trim() || defaultTitle(input.prepared.originalName),
				original_filename: input.prepared.originalName,
				prepared_storage_path: storagePath,
				source_storage_path: sourcePath,
				thumbnail_storage_path: thumbnailPath,
				prepared_sha256: sha256,
				source_sha256: sourceSha256,
				preprocessing_profile: preprocessing.profile,
				preprocessing_version: preprocessing.version,
				preprocessing_auto_crop: preprocessing.autoCropApplied,
				preprocessing_retained_permille: preprocessing.retainedAreaPermille,
				preprocessing_deskew_mdeg: preprocessing.deskewMilliDegrees,
				preprocessing_illumination: preprocessing.illuminationNormalized,
				preprocessing_contrast: preprocessing.contrastEnhanced,
				preprocessing_fallback: preprocessing.fallbackToStandard,
				preprocessing_source_width: preprocessing.sourceWidth,
				preprocessing_source_height: preprocessing.sourceHeight,
				preprocessing_prepared_width: preprocessing.preparedWidth,
				preprocessing_prepared_height: preprocessing.preparedHeight,
				preprocessing_original_bytes: input.prepared.original.size,
				preprocessing_prepared_bytes: input.prepared.image.size,
				source_created_at: input.sourceCreatedAt ?? null,
				prompt_version: promptVersion
			});
		} catch {
			await removeUploaded(gateway, uploadedPaths);
			throw new ImageUploadError('metadata_failed');
		}
		let imported: Readonly<ImageImportIdentifiers>;
		try {
			if (metadataResult.error) invalidImageImportResult();
			imported = parseImageImportResult(metadataResult.data, { documentId, pageId, ocrJobId });
		} catch {
			await removeUploaded(gateway, uploadedPaths);
			throw new ImageUploadError('metadata_failed');
		}

		return Object.freeze({
			...imported,
			sha256,
			storagePath: sourcePath,
			thumbnailPath
		});
	}, signal);
}

export async function uploadPreparedImage(
	input: UploadPreparedImageInput,
	client?: SupabaseClient<Database>
): Promise<UploadedPage> {
	if (client !== undefined) return uploadPreparedImageToSupabase(input, client);
	const { uploadPreparedImageToDrive } = await import('./drive-upload');
	return uploadPreparedImageToDrive(input);
}
