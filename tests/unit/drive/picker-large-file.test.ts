import { describe, expect, it, vi } from 'vitest';
import {
	MAX_DIRECT_PICKER_DOWNLOAD_BYTES,
	selectAndDownloadGoogleDriveFile
} from '../../../src/lib/drive/picker-service';

const source = {
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_key_1234567890',
	PUBLIC_GOOGLE_CLIENT_ID: '123456789012-example.apps.googleusercontent.com',
	PUBLIC_GOOGLE_PICKER_API_KEY: ['AI', 'zaSyFixturePickerIdentifier_1234567890'].join(''),
	PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: '123456789012'
};

function selection(sizeBytes: number) {
	return {
		id: '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
		name: 'Apostila.pdf',
		mimeType: 'application/pdf' as const,
		sizeBytes,
		modifiedAt: '2026-08-06T10:00:00.000Z'
	};
}

describe('large Google Picker files', () => {
	it('allows a technical direct-download ceiling up to 50 MiB', async () => {
		const selected = selection(30 * 1024 * 1024);
		const download = vi.fn().mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));

		await expect(
			selectAndDownloadGoogleDriveFile({
				mimeTypes: ['application/pdf'],
				maximumBytes: MAX_DIRECT_PICKER_DOWNLOAD_BYTES,
				source,
				client: {} as never,
				dependencies: { select: vi.fn().mockResolvedValue(selected), download }
			})
		).resolves.toBeInstanceOf(File);
		expect(download).toHaveBeenCalledTimes(1);
	});

	it('does not download a selected file that exceeds the configured browser path', async () => {
		const download = vi.fn();
		await expect(
			selectAndDownloadGoogleDriveFile({
				mimeTypes: ['application/pdf'],
				maximumBytes: MAX_DIRECT_PICKER_DOWNLOAD_BYTES,
				source,
				client: {} as never,
				dependencies: {
					select: vi.fn().mockResolvedValue(selection(MAX_DIRECT_PICKER_DOWNLOAD_BYTES + 1)),
					download
				}
			})
		).rejects.toThrow('excede o caminho de download direto');
		expect(download).not.toHaveBeenCalled();
	});
});
