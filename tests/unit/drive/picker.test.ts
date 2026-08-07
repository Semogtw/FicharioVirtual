import { describe, expect, it, vi } from 'vitest';
import {
	GOOGLE_PICKER_MIME_TYPES,
	loadGooglePickerApi,
	openGoogleDrivePicker,
	parsePickerSelection,
	type GooglePickerRuntime
} from '../../../src/lib/drive/picker';

const accessToken = 'ephemeral-access-token-value';
const apiKey = ['AI', 'zaSyFixturePublicPickerKey_1234567890'].join('');
const appId = '123456789012';
const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

describe('Google Picker contracts', () => {
	it('accepts one exact supported file selection and rejects extra fields', () => {
		expect(
			parsePickerSelection({
				action: 'picked',
				docs: [
					{
						id: fileId,
						name: 'Apostila.pdf',
						mimeType: 'application/pdf',
						sizeBytes: '2048',
						lastEditedUtc: 1786000000000
					}
				]
			})
		).toEqual({
			id: fileId,
			name: 'Apostila.pdf',
			mimeType: 'application/pdf',
			sizeBytes: 2048,
			modifiedAt: '2026-08-04T18:13:20.000Z'
		});
		expect(parsePickerSelection({ action: 'cancel', docs: [] })).toBeNull();
		expect(() =>
			parsePickerSelection({
				action: 'picked',
				docs: [
					{
						id: fileId,
						name: 'Apostila.pdf',
						mimeType: 'application/pdf',
						sizeBytes: '2048',
						lastEditedUtc: 1786000000000,
						accessToken: 'must-not-pass'
					}
				]
			})
		).toThrow('Invalid Google Picker response');
	});

	it('rejects unsupported type, multiple documents, and oversized metadata', () => {
		expect(() =>
			parsePickerSelection({
				action: 'picked',
				docs: [
					{
						id: fileId,
						name: 'Planilha.xlsx',
						mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
						sizeBytes: '2048',
						lastEditedUtc: 1786000000000
					}
				]
			})
		).toThrow('Invalid Google Picker response');
		expect(() =>
			parsePickerSelection({
				action: 'picked',
				docs: [
					{
						id: fileId,
						name: 'A.pdf',
						mimeType: 'application/pdf',
						sizeBytes: '1',
						lastEditedUtc: 1786000000000
					},
					{
						id: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
						name: 'B.pdf',
						mimeType: 'application/pdf',
						sizeBytes: '1',
						lastEditedUtc: 1786000000000
					}
				]
			})
		).toThrow('Invalid Google Picker response');
	});

	it('loads the Picker module after api.js exposes only the gapi loader', async () => {
		const scripts: Array<{
			src: string;
			onload: null | (() => void);
			onerror: null | (() => void);
		}> = [];
		const documentLike = {
			querySelector: vi.fn().mockReturnValue(null),
			createElement: vi.fn(() => ({
				src: '',
				async: false,
				defer: false,
				onload: null,
				onerror: null
			})),
			head: {
				appendChild(script: (typeof scripts)[number]) {
					scripts.push(script);
					setTimeout(() => script.onload?.(), 0);
				}
			}
		};
		const runtime = {
			gapi: { load: vi.fn() },
			google: { picker: {} as Record<string, unknown> }
		};
		runtime.gapi.load.mockImplementation((_name: string, callback: () => void) => {
			Object.assign(runtime.google.picker, {
				Action: { PICKED: 'picked', CANCEL: 'cancel' },
				DocsView: vi.fn(),
				Feature: { MULTISELECT_ENABLED: 'multiselect' },
				PickerBuilder: vi.fn()
			});
			callback();
		});

		await expect(
			loadGooglePickerApi({ documentLike: documentLike as never, runtime })
		).resolves.toBe(runtime);
		expect(scripts[0]?.src).toBe('https://apis.google.com/js/api.js');
		expect(runtime.gapi.load).toHaveBeenCalledWith('picker', expect.any(Function));
	});

	it('builds one-file Picker with the approved MIME types and strict callback', async () => {
		const view = {
			setMimeTypes: vi.fn().mockReturnThis(),
			setIncludeFolders: vi.fn().mockReturnThis(),
			setSelectFolderEnabled: vi.fn().mockReturnThis()
		};
		const picker = { setVisible: vi.fn() };
		const builder = {
			addView: vi.fn().mockReturnThis(),
			setOAuthToken: vi.fn().mockReturnThis(),
			setDeveloperKey: vi.fn().mockReturnThis(),
			setAppId: vi.fn().mockReturnThis(),
			setCallback: vi.fn((_value: (value: unknown) => void) => builder),
			enableFeature: vi.fn().mockReturnThis(),
			build: vi.fn(() => picker)
		};
		const runtime: GooglePickerRuntime = {
			gapi: { load: vi.fn() },
			google: {
				picker: {
					Action: { PICKED: 'picked', CANCEL: 'cancel' },
					DocsView: vi.fn(() => view),
					Feature: { MULTISELECT_ENABLED: 'multiselect' },
					PickerBuilder: vi.fn(() => builder)
				}
			}
		};

		const pending = openGoogleDrivePicker({ accessToken, apiKey, appId, runtime });
		expect(view.setMimeTypes).toHaveBeenCalledWith(GOOGLE_PICKER_MIME_TYPES.join(','));
		expect(builder.setOAuthToken).toHaveBeenCalledWith(accessToken);
		expect(builder.setDeveloperKey).toHaveBeenCalledWith(apiKey);
		expect(builder.setAppId).toHaveBeenCalledWith(appId);
		expect(builder.enableFeature).not.toHaveBeenCalled();
		expect(picker.setVisible).toHaveBeenCalledWith(true);
		const callback = builder.setCallback.mock.calls[0]?.[0];
		expect(callback).toBeTypeOf('function');
		callback?.({
			action: 'picked',
			docs: [
				{
					id: fileId,
					name: 'Apostila.pdf',
					mimeType: 'application/pdf',
					sizeBytes: '2048',
					lastEditedUtc: 1786000000000
				}
			]
		});
		await expect(pending).resolves.toMatchObject({ id: fileId, name: 'Apostila.pdf' });
	});
});
