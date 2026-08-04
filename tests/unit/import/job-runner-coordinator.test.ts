import { describe, expect, it, vi } from 'vitest';
import {
	BrowserOcrQueueCoordinator,
	type OcrQueueLeaseStorage
} from '../../../src/lib/import/job-runner';

const LEASE_KEY = 'fichario-ocr-runner-lease';

class MemoryStorage implements OcrQueueLeaseStorage {
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
	storage: OcrQueueLeaseStorage | null,
	overrides: Partial<ConstructorParameters<typeof BrowserOcrQueueCoordinator>[0]> = {}
) {
	return new BrowserOcrQueueCoordinator({
		ownerId: 'tab-a',
		lockManager: null,
		storage,
		channel: null,
		now: () => 1_000,
		wait: vi.fn(async () => undefined),
		setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
		clearInterval: vi.fn(),
		...overrides
	});
}

describe('BrowserOcrQueueCoordinator fallback lease', () => {
	it('rejects work while another tab owns a live lease', async () => {
		const storage = new MemoryStorage();
		storage.setItem(LEASE_KEY, lease('tab-b', 2_000));
		const task = vi.fn(async () => undefined);

		const acquired = await coordinator(storage).runExclusive(task);

		expect(acquired).toBe(false);
		expect(task).not.toHaveBeenCalled();
		expect(storage.getItem(LEASE_KEY)).toBe(lease('tab-b', 2_000));
	});

	it('acquires, renews and releases its own lease', async () => {
		const storage = new MemoryStorage();
		let heartbeat: (() => void) | undefined;
		const clearInterval = vi.fn();
		const task = vi.fn(async () => {
			expect(storage.getItem(LEASE_KEY)).toBe(lease('tab-a', 16_000));
			heartbeat?.();
			expect(storage.getItem(LEASE_KEY)).toBe(lease('tab-a', 16_000));
		});
		const crossTab = coordinator(storage, {
			setInterval: vi.fn((callback) => {
				heartbeat = callback;
				return 7 as unknown as ReturnType<typeof setInterval>;
			}),
			clearInterval
		});

		const acquired = await crossTab.runExclusive(task);

		expect(acquired).toBe(true);
		expect(task).toHaveBeenCalledOnce();
		expect(clearInterval).toHaveBeenCalledOnce();
		expect(storage.getItem(LEASE_KEY)).toBeNull();
	});

	it('backs out when ownership changes during the settling window', async () => {
		const storage = new MemoryStorage();
		const task = vi.fn(async () => undefined);
		const wait = vi.fn(async () => {
			storage.setItem(LEASE_KEY, lease('tab-b', 2_000));
		});

		const acquired = await coordinator(storage, { wait }).runExclusive(task);

		expect(acquired).toBe(false);
		expect(task).not.toHaveBeenCalled();
		expect(storage.getItem(LEASE_KEY)).toBe(lease('tab-b', 2_000));
	});

	it('does not remove a lease taken over while its task is running', async () => {
		const storage = new MemoryStorage();
		const task = vi.fn(async () => {
			storage.setItem(LEASE_KEY, lease('tab-b', 2_000));
		});

		const acquired = await coordinator(storage).runExclusive(task);

		expect(acquired).toBe(true);
		expect(storage.getItem(LEASE_KEY)).toBe(lease('tab-b', 2_000));
	});

	it('keeps single-context execution when browser storage is unavailable', async () => {
		const task = vi.fn(async () => undefined);

		const acquired = await coordinator(null).runExclusive(task);

		expect(acquired).toBe(true);
		expect(task).toHaveBeenCalledOnce();
	});
});
