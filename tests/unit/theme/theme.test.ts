import { describe, expect, it } from 'vitest';
import {
	DEFAULT_THEME,
	THEMES,
	THEME_STORAGE_KEY,
	applyTheme,
	initializeTheme,
	isThemeId,
	readStoredTheme,
	selectTheme
} from '$lib/theme/theme';

function createStorage(initial: string | null = null) {
	let value = initial;
	return {
		getItem(key: string) {
			expect(key).toBe(THEME_STORAGE_KEY);
			return value;
		},
		setItem(key: string, next: string) {
			expect(key).toBe(THEME_STORAGE_KEY);
			value = next;
		},
		value() {
			return value;
		}
	};
}

function createDocument() {
	const meta = {
		content: '',
		setAttribute(name: string, value: string) {
			if (name === 'content') this.content = value;
		}
	};
	return {
		documentElement: { dataset: {} as Record<string, string | undefined> },
		querySelector(selector: string) {
			expect(selector).toBe('meta[name="theme-color"]');
			return meta;
		},
		meta
	};
}

describe('editorial themes', () => {
	it('exposes the four approved palettes and validates only their identifiers', () => {
		expect(THEMES.map((theme) => theme.name)).toEqual([
			'Arquivo',
			'Rosa Pastel',
			'Azul Neblina',
			'Lavanda Papel'
		]);
		for (const theme of THEMES) expect(isThemeId(theme.id)).toBe(true);
		expect(isThemeId('neon')).toBe(false);
		expect(isThemeId(null)).toBe(false);
	});

	it('falls back safely when storage is empty, invalid or unavailable', () => {
		expect(readStoredTheme(createStorage())).toBe(DEFAULT_THEME);
		expect(readStoredTheme(createStorage('neon'))).toBe(DEFAULT_THEME);
		expect(
			readStoredTheme({
				getItem() {
					throw new Error('blocked');
				}
			})
		).toBe(DEFAULT_THEME);
	});

	it('applies the theme to the root and browser chrome color', () => {
		const documentLike = createDocument();
		applyTheme('rose', documentLike);

		expect(documentLike.documentElement.dataset.theme).toBe('rose');
		expect(documentLike.meta.content).toBe(
			THEMES.find((theme) => theme.id === 'rose')?.metaThemeColor
		);
	});

	it('persists and applies a selected theme even when storage later becomes unavailable', () => {
		const storage = createStorage();
		const documentLike = createDocument();
		selectTheme('mist', storage, documentLike);

		expect(storage.value()).toBe('mist');
		expect(documentLike.documentElement.dataset.theme).toBe('mist');

		expect(() =>
			selectTheme(
				'lavender',
				{
					setItem() {
						throw new Error('blocked');
					}
				},
				documentLike
			)
		).not.toThrow();
		expect(documentLike.documentElement.dataset.theme).toBe('lavender');
	});

	it('initializes from storage and follows cross-tab storage changes', () => {
		const storage = createStorage('rose');
		const documentLike = createDocument();
		const storageListeners: Array<
			(event: { key: string | null; newValue: string | null }) => void
		> = [];
		const windowLike = {
			addEventListener(
				type: string,
				listener: (event: { key: string | null; newValue: string | null }) => void
			) {
				expect(type).toBe('storage');
				storageListeners.push(listener);
			}
		};

		expect(initializeTheme(storage, documentLike, windowLike)).toBe('rose');
		expect(documentLike.documentElement.dataset.theme).toBe('rose');

		storageListeners[0]?.({ key: THEME_STORAGE_KEY, newValue: 'lavender' });
		expect(documentLike.documentElement.dataset.theme).toBe('lavender');

		storageListeners[0]?.({ key: THEME_STORAGE_KEY, newValue: 'invalid' });
		expect(documentLike.documentElement.dataset.theme).toBe(DEFAULT_THEME);

		storageListeners[0]?.({ key: 'unrelated', newValue: 'mist' });
		expect(documentLike.documentElement.dataset.theme).toBe(DEFAULT_THEME);
	});
});
