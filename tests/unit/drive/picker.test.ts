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
const editedAt = 1786000000000;

function picked(sizeBytes = '2048') {
	return {
		action: 'picked',
		docs: [
			{
				id: fileId,
				name: 'Apostila.pdf',
				mimeType: 'application/pdf',
				sizeBytes,
				lastEditedUtc: editedAt
			}
		]
	};
}

describe('Google Picker contracts', () => {
	it('accepts one exact supported file selection and rejects extra fields', () => {
		expect(parsePickerSelection(picked())).toEqual({
			id: fileId,
			name: 'Apostila.pdf',
			mimeType: 'application/pdf',
			sizeBytes: 2048,
			modifiedAt: '2026-08-06T07:06:40.000Z'
		});
		expect(parsePickerSelection({ action: 'cancel', docs: [] })).toBeNull();
		expect(() =>
			parsePickerSelection({
				...picked(),
				docs: [{ ...picked().docs[0], accessToken: 'must-not-pass' }]
			})
		).toThrow('Invalid Google Picker response');
	});

	it('accepts metadata above the direct-download ceiling for reference imports', () => {
		expect(parsePickerSelection(picked(String(30 * 1024 * 1024)))?.sizeBytes).toBe(
			30 * 1024 * 1024
		);
		expect(parsePickerSelection(picked(String(50 * 1024 * 1024)))?.sizeBytes).toBe(
			50 * 1024 * 1024
		);
		expect(parsePickerSelection(picked(String(120 * 1024 * 1024)))?.sizeBytes).toBe(
			120 * 1024 * 1024
		);
	});

	it('rejects unsupported type and multiple documents', () => {
		expect(() =>
			parsePickerSelection({
				action: 'picked',
				docs: [
					{
						id: fileId,
						name: 'Planilha.xlsx',
						mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
						sizeBytes: '2048',
						lastEditedUtc: editedAt
					}
				]
			})
		).toThrow('Invalid Google Picker response');
		expect(() =>
			parsePickerSelection({
				action: 'picked',
				docs: [
					picked('1').docs[0],
					{ ...picked('1').docs[0], id: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456', name: 'B.pdf' }
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
		const runtime = { gapi: { load: vi.fn() }, google: { picker: {} as Record<string, unknown> } };
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
		runtime.gapi.load.mockImplementation((_name: string, callback: () => void) => {
			Object.assign(runtime.google.picker, {
				Action: { PICKED: 'picked', CANCEL: 'cancel' },
				DocsView: function DocsView() {},
				Feature: { MULTISELECT_ENABLED: 'multiselect' },
				PickerBuilder: function PickerBuilder() {}
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
			setCallback: vi.fn().mockReturnThis(),
			enableFeature: vi.fn().mockReturnThis(),
			build: vi.fn(() => picker)
		};
		class DocsViewMock {
			setMimeTypes = view.setMimeTypes;
			setIncludeFolders = view.setIncludeFolders;
			setSelectFolderEnabled = view.setSelectFolderEnabled;
		}
		class PickerBuilderMock {
			addView = builder.addView;
			setOAuthToken = builder.setOAuthToken;
			setDeveloperKey = builder.setDeveloperKey;
			setAppId = builder.setAppId;
			setCallback = builder.setCallback;
			enableFeature = builder.enableFeature;
			build = builder.build;
		}
		const runtime: GooglePickerRuntime = {
			gapi: { load: vi.fn() },
			google: {
				picker: {
					Action: { PICKED: 'picked', CANCEL: 'cancel' },
					DocsView: DocsViewMock,
					Feature: { MULTISELECT_ENABLED: 'multiselect' },
					PickerBuilder: PickerBuilderMock
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
		const callback = builder.setCallback.mock.calls[0]?.[0] as
			((value: unknown) => void) | undefined;
		expect(callback).toBeTypeOf('function');
		callback?.(picked());
		await expect(pending).resolves.toMatchObject({ id: fileId, name: 'Apostila.pdf' });
	});
});
