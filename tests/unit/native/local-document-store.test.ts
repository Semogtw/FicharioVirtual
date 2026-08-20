import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getNativeStatus,
	nativeImportRanges,
	readNativeDocumentRange,
	resolveNativeDocument
} from '../../../src/lib/native/local-document-store';
import { isNativeRuntime } from '../../../src/lib/platform/native-bridge';

type MutableGlobal = typeof globalThis & {
	__TAURI__?: { core: { invoke: ReturnType<typeof vi.fn> } };
};

const root = globalThis as MutableGlobal;

afterEach(() => {
	delete root.__TAURI__;
	vi.restoreAllMocks();
});

describe('native runtime bridge', () => {
	it('stays inert in the web build', async () => {
		expect(isNativeRuntime()).toBe(false);
		expect(await getNativeStatus()).toBeNull();
		expect(await resolveNativeDocument('doc-1')).toBeNull();
	});

	it('uses the globally injected Tauri invoke bridge without a JS package dependency', async () => {
		const invoke = vi.fn().mockResolvedValue({
			platform: 'linux',
			schemaVersion: 1,
			localDocumentCount: 2,
			pendingSyncCount: 1,
			diskUsageBytes: 123,
			maxDocumentBytes: 1000,
			maxIpcChunkBytes: 512
		});
		root.__TAURI__ = { core: { invoke } };
		expect(isNativeRuntime()).toBe(true);
		expect((await getNativeStatus())?.platform).toBe('linux');
		expect(invoke).toHaveBeenCalledWith('native_status', undefined);
	});

	it('reads native ranges from Tauri raw ArrayBuffer responses', async () => {
		const expected = Uint8Array.from([1, 2, 3, 4]);
		const invoke = vi.fn().mockResolvedValue(expected.buffer.slice(0));
		root.__TAURI__ = { core: { invoke } };

		const bytes = await readNativeDocumentRange('doc-1', 4, 8);

		expect(bytes).toEqual(expected);
		expect(invoke).toHaveBeenCalledWith('read_local_document_range', {
			request: { documentId: 'doc-1', start: 4, endExclusive: 8 }
		});
	});
});

describe('native import ranges', () => {
	it('covers the input exactly without overlapping chunks', () => {
		expect(nativeImportRanges(10, 4)).toEqual([
			{ start: 0, endExclusive: 4 },
			{ start: 4, endExclusive: 8 },
			{ start: 8, endExclusive: 10 }
		]);
	});

	it('rejects invalid and oversized IPC chunks', () => {
		expect(() => nativeImportRanges(0, 4)).toThrow();
		expect(() => nativeImportRanges(10, 0)).toThrow();
		expect(() => nativeImportRanges(10, 512 * 1024 + 1)).toThrow();
	});
});
