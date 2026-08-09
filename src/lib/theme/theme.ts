export type ThemeId = 'archive' | 'rose' | 'mist' | 'lavender';

export interface ThemeDefinition {
	id: ThemeId;
	name: string;
	description: string;
	metaThemeColor: string;
	swatches: readonly [string, string, string, string];
}

export interface ThemeStorageReader {
	getItem(key: string): string | null;
}

export interface ThemeStorageWriter {
	setItem(key: string, value: string): void;
}

export interface ThemeMetaElement {
	setAttribute(name: string, value: string): void;
}

export interface ThemeDocument {
	documentElement: {
		dataset: Record<string, string | undefined>;
	};
	querySelector(selector: string): ThemeMetaElement | null;
}

export interface ThemeStorageEvent {
	key: string | null;
	newValue: string | null;
}

export interface ThemeWindow {
	addEventListener(type: 'storage', listener: (event: ThemeStorageEvent) => void): void;
}

export const THEME_STORAGE_KEY = 'fichario-theme';
export const DEFAULT_THEME: ThemeId = 'archive';

export const THEMES: readonly ThemeDefinition[] = [
	{
		id: 'archive',
		name: 'Arquivo',
		description: 'Papel quente, terracota e verde de arquivo.',
		metaThemeColor: '#f7f4ee',
		swatches: ['#f7f4ee', '#536a5b', '#a65e43', '#202124']
	},
	{
		id: 'rose',
		name: 'Rosa Pastel',
		description: 'Rosa antigo suave, malva e papel blush.',
		metaThemeColor: '#fbf5f7',
		swatches: ['#fbf5f7', '#866573', '#b9778f', '#33282d']
	},
	{
		id: 'mist',
		name: 'Azul Neblina',
		description: 'Azul acinzentado, papel frio e contraste sereno.',
		metaThemeColor: '#f3f7f8',
		swatches: ['#f3f7f8', '#4f6872', '#7896a1', '#243034']
	},
	{
		id: 'lavender',
		name: 'Lavanda Papel',
		description: 'Lavanda pálida, violeta fosco e tinta suave.',
		metaThemeColor: '#f7f4fa',
		swatches: ['#f7f4fa', '#665e78', '#9c82ad', '#2d2934']
	}
] as const;

const themeIds = new Set<ThemeId>(THEMES.map((theme) => theme.id));

export function isThemeId(value: unknown): value is ThemeId {
	return typeof value === 'string' && themeIds.has(value as ThemeId);
}

export function readStoredTheme(storage: ThemeStorageReader | null | undefined): ThemeId {
	try {
		const stored = storage?.getItem(THEME_STORAGE_KEY);
		return isThemeId(stored) ? stored : DEFAULT_THEME;
	} catch {
		return DEFAULT_THEME;
	}
}

export function applyTheme(theme: ThemeId, documentLike: ThemeDocument): void {
	documentLike.documentElement.dataset.theme = theme;
	const definition = THEMES.find((candidate) => candidate.id === theme) ?? THEMES[0];
	documentLike
		.querySelector('meta[name="theme-color"]')
		?.setAttribute('content', definition.metaThemeColor);
}

export function selectTheme(
	theme: ThemeId,
	storage: ThemeStorageWriter | null | undefined,
	documentLike: ThemeDocument
): void {
	try {
		storage?.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// A blocked storage backend must not prevent the visual preference from applying.
	}
	applyTheme(theme, documentLike);
}

export function readBrowserTheme(): ThemeId {
	return readStoredTheme(globalThis.localStorage);
}

export function selectBrowserTheme(
	theme: ThemeId,
	documentLike: ThemeDocument = globalThis.document as unknown as ThemeDocument
): void {
	selectTheme(theme, globalThis.localStorage, documentLike);
}

export function initializeTheme(
	storage: ThemeStorageReader | null | undefined = globalThis.localStorage,
	documentLike: ThemeDocument = globalThis.document as unknown as ThemeDocument,
	windowLike: ThemeWindow = globalThis.window as unknown as ThemeWindow
): ThemeId {
	const theme = readStoredTheme(storage);
	applyTheme(theme, documentLike);
	windowLike.addEventListener('storage', (event) => {
		if (event.key !== THEME_STORAGE_KEY) return;
		applyTheme(isThemeId(event.newValue) ? event.newValue : DEFAULT_THEME, documentLike);
	});
	return theme;
}
