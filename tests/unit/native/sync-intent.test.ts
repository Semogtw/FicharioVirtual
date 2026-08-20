import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cancelNativeUploadIntent,
	ensureNativeUploadIntent
} from '../../../src/lib/native/sync-intent';

type MutableGlobal = typeof globalThis & {
	__TAURI__?: { core: { invoke: ReturnType<typeof vi.fn> } };
};

const root = globalThis as MutableGlobal;

afterEach(() => {
	delete root.__TAURI__;
	vi.restoreAllMocks();
});

describe('native upload intent bridge', () => {
	it('stays inert on the web runtime', async () => {
		expect(await ensureNativeUploadIntent('doc')).toBe(false);
		expect(await cancelNativeUploadIntent('doc')).toBe(false);
	});

	it('forwards ensure and cancel operations to the native queue', async () => {
		const invoke = vi.fn().mockResolvedValue(true);
		root.__TAURI__ = { core: { invoke } };

		await expect(ensureNativeUploadIntent('doc-1')).resolves.toBe(true);
		await expect(cancelNativeUploadIntent('doc-1')).resolves.toBe(true);

		expect(invoke).toHaveBeenNthCalledWith(1, 'ensure_native_upload_intent', {
			request: { documentId: 'doc-1' }
		});
		expect(invoke).toHaveBeenNthCalledWith(2, 'cancel_native_upload_intent', {
			request: { documentId: 'doc-1' }
		});
	});
});
