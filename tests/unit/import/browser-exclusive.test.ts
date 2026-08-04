import { describe, expect, it, vi } from 'vitest';
import {
	BrowserExclusiveCoordinator,
	type BrowserExclusiveLockManager,
	type BrowserExclusiveStorage
} from '../../../src/lib/import/browser-exclusive';

class MemoryStorage implements BrowserExclusiveStorage {
	readonly values = new Map<string, string>();

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}
}

function lease(ownerId: string, expiresAt: number) {
	return JSON.stringify({ ownerId, expiresAt });
}

function coordinator(
	storage: BrowserExclusiveStorage | null,
	overrides: Partial<ConstructorParameters<typeof BrowserExclusiveCoordinator>[0]> = {}
) {
	return new BrowserExclusiveCoordinator({
		ownerId: 'tab-a',
		lockManager: null,
		storage,
		now: () => 1_000,
		wait: vi.fn(async () => undefined),
		setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
		clearInterval: vi.fn(),
		...overrides
	});
}

describe('BrowserExclusiveCoordinator', () => {
	it('prefers Web Locks without reading the storage fallback', async () => {
		const storage = new MemoryStorage();
		storage.setItem('operation-lease', lease('tab-b', 2_000));
		const request = vi.fn<BrowserExclusiveLockManager['request']>(
			async (_name, _options, callback) => callback({})
		);
		const task = vi.fn(async () => undefined);
		const crossTab = coordinator(storage, { lockManager: { request } });

		const acquired = await crossTab.runExclusive('operation', task);

		expect(acquired).toBe(true);
		expect(request).toHaveBeenCalledWith(
			'operation',
			{ mode: 'exclusive', ifAvailable: true },
			expect.any(Function)
		);
		expect(task).toHaveBeenCalledOnce();
		expect(storage.getItem('operation-lease')).toBe(lease('tab-b', 2_000));
	});

	it('returns false when Web Locks reports another owner', async () => {
		const request = vi.fn<BrowserExclusiveLockManager['request']>(
			async (_name, _options, callback) => callback(null)
		);
		const task = vi.fn(async () => undefined);

		const acquired = await coordinator(null, { lockManager: { request } }).runExclusive(
			'operation',
			task
		);

		expect(acquired).toBe(false);
		expect(task).not.toHaveBeenCalled();
	});

	it('rejects a live foreign storage lease', async () => {
		const storage = new MemoryStorage();
		storage.setItem('operation-lease', lease('tab-b', 2_000));
		const task = vi.fn(async () => undefined);

		const acquired = await coordinator(storage).runExclusive('operation', task);

		expect(acquired).toBe(false);
		expect(task).not.toHaveBeenCalled();
	});

	it('acquires, renews and releases a storage lease', async () => {
		const storage = new MemoryStorage();
		let heartbeat: (() => void) | undefined;
		const clearInterval = vi.fn();
		const task = vi.fn(async () => {
			expect(storage.getItem('operation-lease')).toBe(lease('tab-a', 16_000));
			heartbeat?.();
			expect(storage.getItem('operation-lease')).toBe(lease('tab-a', 16_000));
		});
		const crossTab = coordinator(storage, {
			setInterval: vi.fn((callback) => {
				heartbeat = callback;
				return 7 as unknown as ReturnType<typeof setInterval>;
			}),
			clearInterval
		});

		const acquired = await crossTab.runExclusive('operation', task);

		expect(acquired).toBe(true);
		expect(clearInterval).toHaveBeenCalledOnce();
		expect(storage.getItem('operation-lease')).toBeNull();
	});

	it('backs out when another tab wins during settling', async () => {
		const storage = new MemoryStorage();
		const task = vi.fn(async () => undefined);
		const wait = vi.fn(async () => {
			storage.setItem('operation-lease', lease('tab-b', 2_000));
		});

		const acquired = await coordinator(storage, { wait }).runExclusive('operation', task);

		expect(acquired).toBe(false);
		expect(task).not.toHaveBeenCalled();
		expect(storage.getItem('operation-lease')).toBe(lease('tab-b', 2_000));
	});

	it('does not remove a lease taken over during its task', async () => {
		const storage = new MemoryStorage();
		const task = vi.fn(async () => {
			storage.setItem('operation-lease', lease('tab-b', 2_000));
		});

		const acquired = await coordinator(storage).runExclusive('operation', task);

		expect(acquired).toBe(true);
		expect(storage.getItem('operation-lease')).toBe(lease('tab-b', 2_000));
	});

	it('fails closed for malformed lease data', async () => {
		const storage = new MemoryStorage();
		storage.setItem('operation-lease', '{"ownerId":"tab-b"}');
		const task = vi.fn(async () => undefined);

		const acquired = await coordinator(storage).runExclusive('operation', task);

		expect(acquired).toBe(false);
		expect(task).not.toHaveBeenCalled();
	});

	it('keeps single-context execution when storage throws', async () => {
		const storage: BrowserExclusiveStorage = {
			getItem() {
				throw new Error('blocked');
			},
			setItem() {
				throw new Error('blocked');
			},
			removeItem() {
				throw new Error('blocked');
			}
		};
		const task = vi.fn(async () => undefined);

		const acquired = await coordinator(storage).runExclusive('operation', task);

		expect(acquired).toBe(true);
		expect(task).toHaveBeenCalledOnce();
	});
});
