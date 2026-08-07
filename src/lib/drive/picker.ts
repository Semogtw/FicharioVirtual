export const GOOGLE_PICKER_MIME_TYPES = Object.freeze([
	'image/jpeg',
	'image/png',
	'image/webp',
	'application/pdf'
] as const);

export type GooglePickerMimeType = (typeof GOOGLE_PICKER_MIME_TYPES)[number];

export interface GooglePickerSelection {
	id: string;
	name: string;
	mimeType: GooglePickerMimeType;
	sizeBytes: number;
	modifiedAt: string;
}

export interface GooglePickerRuntime {
	gapi: {
		load(name: 'picker', callback: () => void): void;
	};
	google: {
		picker: {
			Action: { PICKED: string; CANCEL: string };
			DocsView: new () => {
				setMimeTypes(value: string): unknown;
				setIncludeFolders(value: boolean): unknown;
				setSelectFolderEnabled(value: boolean): unknown;
			};
			Feature: { MULTISELECT_ENABLED: string };
			PickerBuilder: new () => {
				addView(value: unknown): unknown;
				setOAuthToken(value: string): unknown;
				setDeveloperKey(value: string): unknown;
				setAppId(value: string): unknown;
				setCallback(value: (data: unknown) => void): unknown;
				enableFeature(value: string): unknown;
				build(): { setVisible(value: boolean): void };
			};
		};
	};
}

type GooglePickerLoaderRuntime = {
	gapi: {
		load(name: 'picker', callback: () => void): void;
	};
};

type ScriptLike = {
	src: string;
	async: boolean;
	defer: boolean;
	onload: null | (() => void);
	onerror: null | (() => void);
};

type DocumentLike = {
	querySelector(selector: string): ScriptLike | null;
	createElement(name: 'script'): ScriptLike;
	head: { appendChild(script: ScriptLike): void };
};

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const API_KEY = /^AIza[A-Za-z0-9_-]{20,252}$/;
const PROJECT_NUMBER = /^\d{6,20}$/;
let pickerLoad: Promise<GooglePickerRuntime> | null = null;

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function validText(value: unknown, minimum: number, maximum: number): value is string {
	if (typeof value !== 'string' || value.trim().length < minimum || value.trim().length > maximum) {
		return false;
	}
	return ![...value].some((character) => {
		const code = character.codePointAt(0);
		return code !== undefined && (code < 32 || code === 127);
	});
}

function pickerLoaderIsValid(value: unknown): value is GooglePickerLoaderRuntime {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const runtime = value as { gapi?: { load?: unknown } };
	return typeof runtime.gapi?.load === 'function';
}

function runtimeIsValid(value: unknown): value is GooglePickerRuntime {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const runtime = value as Partial<GooglePickerRuntime>;
	return (
		typeof runtime.gapi?.load === 'function' &&
		typeof runtime.google?.picker?.DocsView === 'function' &&
		typeof runtime.google?.picker?.PickerBuilder === 'function'
	);
}

function loadPickerModule(
	runtime: unknown,
	resolve: (runtime: GooglePickerRuntime) => void,
	reject: (reason?: unknown) => void
) {
	if (!pickerLoaderIsValid(runtime)) {
		reject(new Error('Google Picker runtime unavailable'));
		return;
	}
	try {
		runtime.gapi.load('picker', () => {
			if (!runtimeIsValid(runtime)) {
				reject(new Error('Google Picker runtime unavailable'));
				return;
			}
			resolve(runtime);
		});
	} catch (error) {
		reject(error);
	}
}

function validMimeTypes(value: readonly GooglePickerMimeType[]): readonly GooglePickerMimeType[] {
	if (
		value.length < 1 ||
		value.length > GOOGLE_PICKER_MIME_TYPES.length ||
		new Set(value).size !== value.length ||
		!value.every((item) => GOOGLE_PICKER_MIME_TYPES.includes(item))
	) {
		throw new TypeError('Invalid Google Picker configuration');
	}
	return Object.freeze([...value]);
}

export function parsePickerSelection(value: unknown): GooglePickerSelection | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid Google Picker response');
	}
	const response = value as Record<string, unknown>;
	if (!hasExactKeys(response, ['action', 'docs']) || !Array.isArray(response.docs)) {
		throw new TypeError('Invalid Google Picker response');
	}
	if (response.action === 'cancel' && response.docs.length === 0) return null;
	if (response.action !== 'picked' || response.docs.length !== 1) {
		throw new TypeError('Invalid Google Picker response');
	}
	const item = response.docs[0];
	if (item === null || typeof item !== 'object' || Array.isArray(item)) {
		throw new TypeError('Invalid Google Picker response');
	}
	const record = item as Record<string, unknown>;
	if (
		!hasExactKeys(record, ['id', 'name', 'mimeType', 'sizeBytes', 'lastEditedUtc']) ||
		typeof record.id !== 'string' ||
		!DRIVE_ID.test(record.id) ||
		!validText(record.name, 1, 512) ||
		typeof record.mimeType !== 'string' ||
		!GOOGLE_PICKER_MIME_TYPES.includes(record.mimeType as GooglePickerMimeType) ||
		typeof record.sizeBytes !== 'string' ||
		!/^\d{1,16}$/.test(record.sizeBytes) ||
		typeof record.lastEditedUtc !== 'number' ||
		!Number.isSafeInteger(record.lastEditedUtc) ||
		record.lastEditedUtc < 0
	) {
		throw new TypeError('Invalid Google Picker response');
	}
	const sizeBytes = Number(record.sizeBytes);
	const modifiedAt = new Date(record.lastEditedUtc).toISOString();
	if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 20 * 1024 * 1024) {
		throw new TypeError('Invalid Google Picker response');
	}
	return Object.freeze({
		id: record.id,
		name: record.name.trim(),
		mimeType: record.mimeType as GooglePickerMimeType,
		sizeBytes,
		modifiedAt
	});
}

export function loadGooglePickerApi({
	documentLike = document as unknown as DocumentLike,
	runtime = globalThis as unknown
}: {
	documentLike?: DocumentLike;
	runtime?: unknown;
} = {}): Promise<GooglePickerRuntime> {
	if (runtimeIsValid(runtime)) {
		return new Promise((resolve, reject) => loadPickerModule(runtime, resolve, reject));
	}
	if (pickerLoad) return pickerLoad;
	pickerLoad = new Promise<GooglePickerRuntime>((resolve, reject) => {
		const existing = documentLike.querySelector('script[data-fichario-google-picker="true"]');
		if (existing) {
			pickerLoad = null;
			reject(new Error('Google Picker script exists without a trusted runtime'));
			return;
		}
		const script = documentLike.createElement('script');
		script.src = 'https://apis.google.com/js/api.js';
		script.async = true;
		script.defer = true;
		script.onload = () => {
			loadPickerModule(
				runtime,
				(loadedRuntime) => resolve(loadedRuntime),
				(error) => {
					pickerLoad = null;
					reject(error);
				}
			);
		};
		script.onerror = () => {
			pickerLoad = null;
			reject(new Error('Google Picker script failed'));
		};
		documentLike.head.appendChild(script);
	});
	return pickerLoad;
}

function validAccessToken(value: string): string {
	if (!validText(value, 8, 8192)) throw new TypeError('Invalid Google Picker configuration');
	return value;
}

export function openGoogleDrivePicker({
	accessToken,
	apiKey,
	appId,
	runtime,
	mimeTypes = GOOGLE_PICKER_MIME_TYPES
}: {
	accessToken: string;
	apiKey: string;
	appId: string;
	runtime: GooglePickerRuntime;
	mimeTypes?: readonly GooglePickerMimeType[];
}): Promise<GooglePickerSelection | null> {
	if (!runtimeIsValid(runtime) || !API_KEY.test(apiKey) || !PROJECT_NUMBER.test(appId)) {
		throw new TypeError('Invalid Google Picker configuration');
	}
	const safeMimeTypes = validMimeTypes(mimeTypes);
	const pickerApi = runtime.google.picker;
	return new Promise((resolve, reject) => {
		try {
			const view = new pickerApi.DocsView();
			view.setMimeTypes(safeMimeTypes.join(','));
			view.setIncludeFolders(false);
			view.setSelectFolderEnabled(false);
			const builder = new pickerApi.PickerBuilder();
			builder.addView(view);
			builder.setOAuthToken(validAccessToken(accessToken));
			builder.setDeveloperKey(apiKey);
			builder.setAppId(appId);
			builder.setCallback((data) => {
				try {
					const selection = parsePickerSelection(data);
					if (selection !== null && !safeMimeTypes.includes(selection.mimeType)) {
						throw new TypeError('Invalid Google Picker response');
					}
					resolve(selection);
				} catch (error) {
					reject(error);
				}
			});
			builder.build().setVisible(true);
		} catch (error) {
			reject(error);
		}
	});
}
