import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();

vi.mock('$lib/platform/native-bridge', () => ({
	invokeNative: invoke,
	isNativeRuntime: () => true
}));

describe('native sync-once bridge', () => {
	beforeEach(() => {
		invoke.mockReset();
	});

	it('validates the runtime mode response', async () => {
		invoke.mockResolvedValueOnce(true);
		const { getNativeSyncOnceMode } = await import('../../../src/lib/native/sync-once');

		expect(await getNativeSyncOnceMode()).toBe(true);
		expect(invoke).toHaveBeenCalledWith('native_sync_once_mode');

		invoke.mockResolvedValueOnce('true');
		await expect(getNativeSyncOnceMode()).rejects.toThrow('Invalid native sync-once mode');
	});

	it('requests controlled process exit after the one-shot worker', async () => {
		const { finishNativeSyncOnce } = await import('../../../src/lib/native/sync-once');

		await finishNativeSyncOnce();
		expect(invoke).toHaveBeenCalledWith('finish_native_sync_once');
	});
});
