import type { SupabaseClient } from '@supabase/supabase-js';
import type { DatabaseWithNotebookBanners } from '$lib/types/database-notebook-banner-extensions';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_WIDTH = 2_000;
const MAX_OUTPUT_HEIGHT = 1_200;
const BANNER_BUCKET = 'documents';
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BANNER_PATH = /^[0-9a-f-]{36}\/notebook-banners\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]{1,160}$/;

export type NotebookBannerPosition = Readonly<{ x: number; y: number }>;
export type NotebookBannerState = Readonly<{
	bannerPath: string;
	positionX: number;
	positionY: number;
}>;

export class NotebookBannerError extends Error {
	readonly code:
		'invalid_file' | 'file_too_large' | 'decode_failed' | 'save_failed' | 'remove_failed';

	constructor(code: NotebookBannerError['code']) {
		const messages = {
			invalid_file: 'Escolha uma imagem JPG, PNG ou WebP válida.',
			file_too_large: 'O banner deve ter no máximo 12 MB antes da otimização.',
			decode_failed: 'Não foi possível preparar esta imagem para o banner.',
			save_failed: 'Não foi possível salvar o banner agora.',
			remove_failed: 'Não foi possível remover o banner agora.'
		} as const;
		super(messages[code]);
		this.name = 'NotebookBannerError';
		this.code = code;
	}
}

function clientOrDefault(client?: SupabaseClient<DatabaseWithNotebookBanners>) {
	return client ?? (getSupabaseClient() as unknown as SupabaseClient<DatabaseWithNotebookBanners>);
}

function validNotebookId(value: string) {
	if (!UUID.test(value)) throw new TypeError('Invalid notebook identifier');
	return value;
}

export function parseBannerPosition(value: number): number {
	if (!Number.isInteger(value) || value < 0 || value > 100) {
		throw new TypeError('Invalid banner position');
	}
	return value;
}

export function validateNotebookBannerFile(file: Pick<File, 'type' | 'size'>): void {
	if (!ALLOWED_TYPES.has(file.type) || file.size < 1) {
		throw new NotebookBannerError('invalid_file');
	}
	if (file.size > MAX_SOURCE_BYTES) throw new NotebookBannerError('file_too_large');
}

function extensionForType(type: string) {
	if (type === 'image/webp') return 'webp';
	if (type === 'image/png') return 'png';
	return 'jpg';
}

function randomAssetId() {
	return (
		globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
	);
}

export function notebookBannerObjectPath(userId: string, notebookId: string, mimeType: string) {
	if (!UUID.test(userId)) throw new TypeError('Invalid user identifier');
	const validatedNotebookId = validNotebookId(notebookId);
	if (!ALLOWED_TYPES.has(mimeType)) throw new TypeError('Invalid banner content type');
	return `${userId}/notebook-banners/${validatedNotebookId}/${randomAssetId()}.${extensionForType(mimeType)}`;
}

async function prepareNotebookBanner(file: File): Promise<Blob> {
	validateNotebookBannerFile(file);
	if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

	let bitmap: ImageBitmap | null = null;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
		const scale = Math.min(1, MAX_OUTPUT_WIDTH / bitmap.width, MAX_OUTPUT_HEIGHT / bitmap.height);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) throw new NotebookBannerError('decode_failed');
		context.drawImage(bitmap, 0, 0, width, height);
		const optimized = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, 'image/webp', 0.86);
		});
		if (!optimized || optimized.size < 1) throw new NotebookBannerError('decode_failed');
		return optimized.size < file.size || file.type === 'image/png' ? optimized : file;
	} catch (error) {
		if (error instanceof NotebookBannerError) throw error;
		throw new NotebookBannerError('decode_failed');
	} finally {
		bitmap?.close();
	}
}

async function currentUserId(client: SupabaseClient<DatabaseWithNotebookBanners>): Promise<string> {
	try {
		const { data, error } = await client.auth.getSession();
		if (error || data.session === null || !UUID.test(data.session.user.id)) {
			throw new NotebookBannerError('save_failed');
		}
		return data.session.user.id;
	} catch {
		throw new NotebookBannerError('save_failed');
	}
}

type BannerRow = {
	banner_path: string | null;
	banner_position_x: number;
	banner_position_y: number;
};

async function loadBannerRow(
	client: SupabaseClient<DatabaseWithNotebookBanners>,
	notebookId: string
): Promise<BannerRow> {
	const { data, error } = await client
		.from('notebooks')
		.select('banner_path,banner_position_x,banner_position_y')
		.eq('id', validNotebookId(notebookId))
		.maybeSingle();
	if (error || !data) throw new NotebookBannerError('save_failed');
	return data as BannerRow;
}

export async function createNotebookBannerUrl(
	path: string,
	client?: SupabaseClient<DatabaseWithNotebookBanners>
): Promise<string> {
	if (path.length > 1_024 || path.includes('..') || !BANNER_PATH.test(path)) {
		throw new TypeError('Invalid notebook banner path');
	}
	const { data, error } = await clientOrDefault(client)
		.storage.from(BANNER_BUCKET)
		.createSignedUrl(path, 3_600);
	if (error || !data?.signedUrl) throw new NotebookBannerError('save_failed');
	return data.signedUrl;
}

export async function saveNotebookBanner(
	notebookId: string,
	input: { file?: File | null; positionX: number; positionY: number },
	client?: SupabaseClient<DatabaseWithNotebookBanners>
): Promise<NotebookBannerState> {
	const validatedNotebookId = validNotebookId(notebookId);
	const positionX = parseBannerPosition(input.positionX);
	const positionY = parseBannerPosition(input.positionY);
	const resolvedClient = clientOrDefault(client);
	const current = await loadBannerRow(resolvedClient, validatedNotebookId);
	let uploadedPath: string | null = null;
	let notebookUpdated = false;

	try {
		if (input.file) {
			const prepared = await prepareNotebookBanner(input.file);
			const userId = await currentUserId(resolvedClient);
			uploadedPath = notebookBannerObjectPath(userId, validatedNotebookId, prepared.type);
			const { error: uploadError } = await resolvedClient.storage
				.from(BANNER_BUCKET)
				.upload(uploadedPath, prepared, {
					cacheControl: '31536000',
					contentType: prepared.type,
					upsert: false
				});
			if (uploadError) throw new NotebookBannerError('save_failed');
		}

		const bannerPath = uploadedPath ?? current.banner_path;
		if (!bannerPath) throw new NotebookBannerError('invalid_file');
		const { error: updateError } = await resolvedClient
			.from('notebooks')
			.update({
				banner_path: bannerPath,
				banner_position_x: positionX,
				banner_position_y: positionY
			})
			.eq('id', validatedNotebookId);
		if (updateError) throw new NotebookBannerError('save_failed');
		notebookUpdated = true;

		if (uploadedPath && current.banner_path && current.banner_path !== uploadedPath) {
			try {
				await resolvedClient.storage.from(BANNER_BUCKET).remove([current.banner_path]);
			} catch {
				// The notebook already points at the new banner. A stale private object is safer
				// than rolling back the new object and leaving the notebook with a broken path.
			}
		}
		return Object.freeze({ bannerPath, positionX, positionY });
	} catch (error) {
		if (uploadedPath && !notebookUpdated) {
			try {
				await resolvedClient.storage.from(BANNER_BUCKET).remove([uploadedPath]);
			} catch {
				// Best-effort rollback of an upload that never became the active banner.
			}
		}
		if (error instanceof NotebookBannerError) throw error;
		throw new NotebookBannerError('save_failed');
	}
}

export async function removeNotebookBanner(
	notebookId: string,
	client?: SupabaseClient<DatabaseWithNotebookBanners>
): Promise<void> {
	const validatedNotebookId = validNotebookId(notebookId);
	const resolvedClient = clientOrDefault(client);
	const current = await loadBannerRow(resolvedClient, validatedNotebookId);
	try {
		const { error } = await resolvedClient
			.from('notebooks')
			.update({ banner_path: null, banner_position_x: 50, banner_position_y: 50 })
			.eq('id', validatedNotebookId);
		if (error) throw new NotebookBannerError('remove_failed');
	} catch (error) {
		if (error instanceof NotebookBannerError) throw error;
		throw new NotebookBannerError('remove_failed');
	}

	if (current.banner_path) {
		try {
			await resolvedClient.storage.from(BANNER_BUCKET).remove([current.banner_path]);
		} catch {
			// The database is already authoritative: storage cleanup is best-effort.
		}
	}
}
