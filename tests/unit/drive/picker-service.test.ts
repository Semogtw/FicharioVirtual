import { describe, expect, it, vi } from 'vitest';
import {
	isGooglePickerConfigured,
	selectGoogleDriveFile,
	selectAndDownloadGoogleDriveFile
} from '../../../src/lib/drive/picker-service';

const source = {
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_key_1234567890',
	PUBLIC_GOOGLE_CLIENT_ID: '123456789012-example.apps.googleusercontent.com',
	PUBLIC_GOOGLE_PICKER_API_KEY: ['AI', 'zaSyFixturePickerIdentifier_1234567890'].join(''),
	PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: '123456789012'
};
const selection = {
	id: '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
	name: 'Apostila.pdf',
	mimeType: 'application/pdf' as const,
	sizeBytes: 2048,
	modifiedAt: '2026-08-06T10:00:00.000Z'
};

describe('Google Picker product service', () => {
	it('detects only a complete public Picker configuration', () => {
		expect(isGooglePickerConfigured(source)).toBe(true);
		expect(
			isGooglePickerConfigured({
				PUBLIC_SUPABASE_URL: source.PUBLIC_SUPABASE_URL,
				PUBLIC_SUPABASE_PUBLISHABLE_KEY: source.PUBLIC_SUPABASE_PUBLISHABLE_KEY
			})
		).toBe(false);
	});

	it('requests an ephemeral token and opens a restricted Picker', async () => {
		const requestAccess = vi.fn().mockResolvedValue({
			accessToken: 'ephemeral-access-token-value',
			expiresAt: '2026-08-06T11:00:00.000Z'
		});
		const runtime = { trusted: true };
		const loadPicker = vi.fn().mockResolvedValue(runtime);
		const openPicker = vi.fn().mockResolvedValue(selection);

		await expect(
			selectGoogleDriveFile({
				mimeTypes: ['application/pdf'],
				source,
				client: {} as never,
				dependencies: { requestAccess, loadPicker, openPicker }
			})
		).resolves.toEqual(selection);
		expect(requestAccess).toHaveBeenCalledTimes(1);
		expect(loadPicker).toHaveBeenCalledTimes(1);
		expect(openPicker).toHaveBeenCalledWith({
			accessToken: 'ephemeral-access-token-value',
			apiKey: source.PUBLIC_GOOGLE_PICKER_API_KEY,
			appId: source.PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER,
			runtime,
			mimeTypes: ['application/pdf']
		});
	});

	it('returns cancellation and rejects unavailable or unsupported configuration', async () => {
		const dependencies = {
			requestAccess: vi.fn().mockResolvedValue({
				accessToken: 'ephemeral-access-token-value',
				expiresAt: '2026-08-06T11:00:00.000Z'
			}),
			loadPicker: vi.fn().mockResolvedValue({}),
			openPicker: vi.fn().mockResolvedValue(null)
		};
		await expect(
			selectGoogleDriveFile({
				mimeTypes: ['image/webp'],
				source,
				client: {} as never,
				dependencies
			})
		).resolves.toBeNull();
		await expect(
			selectGoogleDriveFile({
				mimeTypes: [],
				source,
				client: {} as never,
				dependencies
			})
		).rejects.toThrow('Não foi possível abrir o Google Drive.');
		await expect(
			selectGoogleDriveFile({
				mimeTypes: ['application/pdf'],
				source: {
					PUBLIC_SUPABASE_URL: source.PUBLIC_SUPABASE_URL,
					PUBLIC_SUPABASE_PUBLISHABLE_KEY: source.PUBLIC_SUPABASE_PUBLISHABLE_KEY
				},
				client: {} as never,
				dependencies
			})
		).rejects.toThrow('Google Picker ainda não está configurado.');
	});

	it('downloads the selected file into a bounded browser File', async () => {
		const select = vi.fn().mockResolvedValue(selection);
		const download = vi
			.fn()
			.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));

		const result = await selectAndDownloadGoogleDriveFile({
			mimeTypes: ['application/pdf'],
			maximumBytes: 20 * 1024 * 1024,
			source,
			client: {} as never,
			dependencies: { select, download }
		});

		expect(result).toBeInstanceOf(File);
		expect(result?.name).toBe('Apostila.pdf');
		expect(result?.type).toBe('application/pdf');
		expect(result?.lastModified).toBe(Date.parse(selection.modifiedAt));
		expect(download).toHaveBeenCalledWith({
			client: {},
			fileId: selection.id,
			maximumBytes: 20 * 1024 * 1024
		});
	});

	it('rejects downloaded bytes whose MIME type no longer matches the selection', async () => {
		await expect(
			selectAndDownloadGoogleDriveFile({
				mimeTypes: ['application/pdf'],
				maximumBytes: 20 * 1024 * 1024,
				source,
				client: {} as never,
				dependencies: {
					select: vi.fn().mockResolvedValue(selection),
					download: vi.fn().mockResolvedValue(new Blob(['bad'], { type: 'text/plain' }))
				}
			})
		).rejects.toThrow('O arquivo baixado do Google Drive não corresponde à seleção.');
	});
});
