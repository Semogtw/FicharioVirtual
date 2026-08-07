import { env } from '$env/dynamic/public';
import { parsePublicEnv } from '$lib/env/public';
import { getSupabaseClient } from '$lib/services/supabase';
import { downloadBrowserDriveFile } from './browser-files';
import { requestDriveAccessToken, type DriveTokenClientLike } from './browser-upload';
import {
	GOOGLE_PICKER_MIME_TYPES,
	loadGooglePickerApi,
	openGoogleDrivePicker,
	type GooglePickerMimeType,
	type GooglePickerRuntime,
	type GooglePickerSelection
} from './picker';

export const MAX_DIRECT_PICKER_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export interface GooglePickerServiceDependencies {
	requestAccess(client: DriveTokenClientLike): Promise<{ accessToken: string; expiresAt: string }>;
	loadPicker(): Promise<GooglePickerRuntime>;
	openPicker(input: {
		accessToken: string;
		apiKey: string;
		appId: string;
		runtime: GooglePickerRuntime;
		mimeTypes: readonly GooglePickerMimeType[];
	}): Promise<GooglePickerSelection | null>;
}

export interface GooglePickerDownloadDependencies {
	select(input: {
		mimeTypes: readonly GooglePickerMimeType[];
		source: Record<string, string | undefined>;
		client: DriveTokenClientLike;
	}): Promise<GooglePickerSelection | null>;
	download(input: {
		client: DriveTokenClientLike;
		fileId: string;
		maximumBytes: number;
	}): Promise<Blob>;
}

export type GoogleDriveImportSource =
	| Readonly<{ kind: 'download'; selection: GooglePickerSelection; file: File }>
	| Readonly<{ kind: 'reference'; selection: GooglePickerSelection }>;

function defaultClient(): DriveTokenClientLike {
	return getSupabaseClient() as unknown as DriveTokenClientLike;
}

function validateMimeTypes(
	value: readonly GooglePickerMimeType[]
): readonly GooglePickerMimeType[] {
	if (
		value.length < 1 ||
		value.length > GOOGLE_PICKER_MIME_TYPES.length ||
		new Set(value).size !== value.length ||
		!value.every((item) => GOOGLE_PICKER_MIME_TYPES.includes(item))
	) {
		throw new TypeError('Invalid Google Picker MIME types');
	}
	return Object.freeze([...value]);
}

function pickerConfiguration(source: Record<string, string | undefined>) {
	let parsed;
	try {
		parsed = parsePublicEnv(source);
	} catch {
		throw new Error('Google Picker ainda não está configurado.');
	}
	if (
		parsed.PUBLIC_GOOGLE_CLIENT_ID === null ||
		parsed.PUBLIC_GOOGLE_PICKER_API_KEY === null ||
		parsed.PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER === null
	) {
		throw new Error('Google Picker ainda não está configurado.');
	}
	return Object.freeze({
		apiKey: parsed.PUBLIC_GOOGLE_PICKER_API_KEY,
		appId: parsed.PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
	});
}

export function isGooglePickerConfigured(
	source: Record<string, string | undefined> = env
): boolean {
	try {
		pickerConfiguration(source);
		return true;
	} catch {
		return false;
	}
}

export async function selectGoogleDriveFile({
	mimeTypes,
	source = env,
	client = defaultClient(),
	dependencies = {
		requestAccess: requestDriveAccessToken,
		loadPicker: () => loadGooglePickerApi(),
		openPicker: openGoogleDrivePicker
	}
}: {
	mimeTypes: readonly GooglePickerMimeType[];
	source?: Record<string, string | undefined>;
	client?: DriveTokenClientLike;
	dependencies?: GooglePickerServiceDependencies;
}): Promise<GooglePickerSelection | null> {
	const configuration = pickerConfiguration(source);
	try {
		const safeMimeTypes = validateMimeTypes(mimeTypes);
		const access = await dependencies.requestAccess(client);
		const runtime = await dependencies.loadPicker();
		const selection = await dependencies.openPicker({
			accessToken: access.accessToken,
			apiKey: configuration.apiKey,
			appId: configuration.appId,
			runtime,
			mimeTypes: safeMimeTypes
		});
		if (selection !== null && !safeMimeTypes.includes(selection.mimeType)) {
			throw new TypeError('Invalid Google Picker selection');
		}
		return selection;
	} catch (error) {
		if (error instanceof Error && error.message === 'Google Picker ainda não está configurado.') {
			throw error;
		}
		throw new Error('Não foi possível abrir o Google Drive.');
	}
}

function validDirectDownloadLimit(maximumBytes: number) {
	if (
		!Number.isSafeInteger(maximumBytes) ||
		maximumBytes < 1 ||
		maximumBytes > MAX_DIRECT_PICKER_DOWNLOAD_BYTES
	) {
		throw new TypeError('Invalid Google Drive download limit');
	}
	return maximumBytes;
}

export async function selectGoogleDriveImportSource({
	mimeTypes,
	maximumBytes,
	source = env,
	client = defaultClient(),
	dependencies = {
		select: (input) => selectGoogleDriveFile(input),
		download: downloadBrowserDriveFile
	}
}: {
	mimeTypes: readonly GooglePickerMimeType[];
	maximumBytes: number;
	source?: Record<string, string | undefined>;
	client?: DriveTokenClientLike;
	dependencies?: GooglePickerDownloadDependencies;
}): Promise<GoogleDriveImportSource | null> {
	const safeMaximumBytes = validDirectDownloadLimit(maximumBytes);
	const safeMimeTypes = validateMimeTypes(mimeTypes);
	const selection = await dependencies.select({ mimeTypes: safeMimeTypes, source, client });
	if (selection === null) return null;
	if (!safeMimeTypes.includes(selection.mimeType)) {
		throw new Error('O arquivo selecionado no Google Drive não corresponde ao tipo solicitado.');
	}
	if (selection.sizeBytes > safeMaximumBytes) {
		return Object.freeze({ kind: 'reference', selection });
	}
	const blob = await dependencies.download({
		client,
		fileId: selection.id,
		maximumBytes: safeMaximumBytes
	});
	if (blob.size < 1 || blob.size > safeMaximumBytes || blob.type !== selection.mimeType) {
		throw new Error('O arquivo baixado do Google Drive não corresponde à seleção.');
	}
	const file = new File([blob], selection.name, {
		type: selection.mimeType,
		lastModified: Date.parse(selection.modifiedAt)
	});
	return Object.freeze({ kind: 'download', selection, file });
}

export async function selectAndDownloadGoogleDriveFile({
	mimeTypes,
	maximumBytes,
	source = env,
	client = defaultClient(),
	dependencies = {
		select: (input) => selectGoogleDriveFile(input),
		download: downloadBrowserDriveFile
	}
}: {
	mimeTypes: readonly GooglePickerMimeType[];
	maximumBytes: number;
	source?: Record<string, string | undefined>;
	client?: DriveTokenClientLike;
	dependencies?: GooglePickerDownloadDependencies;
}): Promise<File | null> {
	const selected = await selectGoogleDriveImportSource({
		mimeTypes,
		maximumBytes,
		source,
		client,
		dependencies
	});
	if (selected === null) return null;
	if (selected.kind === 'reference') {
		throw new Error(
			'O arquivo selecionado excede o caminho de download direto. Preserve-o no Drive e importe por referência quando esse fluxo estiver disponível.'
		);
	}
	return selected.file;
}
