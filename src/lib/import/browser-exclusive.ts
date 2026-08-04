const LEASE_DURATION_MS = 15_000;
const LEASE_HEARTBEAT_MS = 5_000;
const LEASE_SETTLE_MS = 50;

export interface BrowserExclusiveStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface BrowserExclusiveLockManager {
	request(
		name: string,
		options: { mode: 'exclusive'; ifAvailable: true },
		callback: (lock: unknown | null) => Promise<void>
	): Promise<void>;
}

type BrowserExclusiveLease = Readonly<{
	ownerId: string;
	expiresAt: number;
}>;

type LeaseReadResult =
	| { state: 'empty' }
	| { state: 'unavailable' }
	| { state: 'invalid' }
	| { state: 'valid'; lease: BrowserExclusiveLease };

export type BrowserExclusiveCoordinatorOptions = {
	ownerId?: string;
	lockManager?: BrowserExclusiveLockManager | null;
	storage?: BrowserExclusiveStorage | null;
	now?: () => number;
	wait?: (milliseconds: number) => Promise<void>;
	setInterval?: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
	clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
};

function browserLockManager(): BrowserExclusiveLockManager | null {
	return typeof navigator === 'undefined'
		? null
		: ((navigator as Navigator & { locks?: BrowserExclusiveLockManager }).locks ?? null);
}

function browserStorage(): BrowserExclusiveStorage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

function ownerId() {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`exclusive_${Date.now()}_${Math.random().toString(36).slice(2)}`
	);
}

function wait(milliseconds: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function exactLeaseKeys(value: Record<string, unknown>) {
	const keys = Object.keys(value).sort();
	return keys.length === 2 && keys[0] === 'expiresAt' && keys[1] === 'ownerId';
}

function parseLease(value: string): BrowserExclusiveLease | null {
	try {
		const parsed: unknown = JSON.parse(value);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const record = parsed as Record<string, unknown>;
		if (!exactLeaseKeys(record)) return null;
		const leaseOwnerId = record.ownerId;
		const expiresAt = record.expiresAt;
		if (
			typeof leaseOwnerId !== 'string' ||
			leaseOwnerId.length < 1 ||
			leaseOwnerId.length > 160 ||
			typeof expiresAt !== 'number' ||
			!Number.isSafeInteger(expiresAt) ||
			expiresAt < 0
		) {
			return null;
		}
		return Object.freeze({ ownerId: leaseOwnerId, expiresAt });
	} catch {
		return null;
	}
}

function storageKey(name: string) {
	return `${name}-lease`;
}

export class BrowserExclusiveCoordinator {
	private readonly ownerId: string;
	private readonly lockManager: BrowserExclusiveLockManager | null;
	private readonly storage: BrowserExclusiveStorage | null;
	private readonly now: () => number;
	private readonly wait: (milliseconds: number) => Promise<void>;
	private readonly scheduleInterval: BrowserExclusiveCoordinatorOptions['setInterval'];
	private readonly cancelInterval: BrowserExclusiveCoordinatorOptions['clearInterval'];

	constructor(options: BrowserExclusiveCoordinatorOptions = {}) {
		this.ownerId = options.ownerId ?? ownerId();
		this.lockManager =
			options.lockManager === undefined ? browserLockManager() : options.lockManager;
		this.storage = options.storage === undefined ? browserStorage() : options.storage;
		this.now = options.now ?? Date.now;
		this.wait = options.wait ?? wait;
		this.scheduleInterval = options.setInterval ?? globalThis.setInterval.bind(globalThis);
		this.cancelInterval = options.clearInterval ?? globalThis.clearInterval.bind(globalThis);
	}

	async runExclusive(name: string, task: () => Promise<void>): Promise<boolean> {
		if (this.lockManager) return this.runWithWebLock(name, task);
		return this.runWithStorageLease(name, task);
	}

	private async runWithWebLock(name: string, task: () => Promise<void>) {
		let acquired = false;
		await this.lockManager?.request(
			name,
			{ mode: 'exclusive', ifAvailable: true },
			async (lock) => {
				if (lock === null) return;
				acquired = true;
				await task();
			}
		);
		return acquired;
	}

	private async runWithStorageLease(name: string, task: () => Promise<void>) {
		if (!this.storage) {
			await task();
			return true;
		}

		const key = storageKey(name);
		const existing = this.readLease(key);
		if (existing.state === 'unavailable') {
			await task();
			return true;
		}
		if (existing.state === 'invalid') return false;
		if (
			existing.state === 'valid' &&
			existing.lease.ownerId !== this.ownerId &&
			existing.lease.expiresAt > this.now()
		) {
			return false;
		}
		if (!this.writeLease(key)) {
			await task();
			return true;
		}

		await this.wait(LEASE_SETTLE_MS);
		const confirmed = this.readLease(key);
		if (
			confirmed.state !== 'valid' ||
			confirmed.lease.ownerId !== this.ownerId ||
			confirmed.lease.expiresAt <= this.now()
		) {
			return false;
		}

		const heartbeat = this.scheduleInterval?.(() => this.renewLease(key), LEASE_HEARTBEAT_MS);
		try {
			await task();
			return true;
		} finally {
			if (heartbeat !== undefined) this.cancelInterval?.(heartbeat);
			this.releaseLease(key);
		}
	}

	private readLease(key: string): LeaseReadResult {
		if (!this.storage) return { state: 'unavailable' };
		let value: string | null;
		try {
			value = this.storage.getItem(key);
		} catch {
			return { state: 'unavailable' };
		}
		if (value === null) return { state: 'empty' };
		const lease = parseLease(value);
		return lease ? { state: 'valid', lease } : { state: 'invalid' };
	}

	private writeLease(key: string) {
		if (!this.storage) return false;
		try {
			this.storage.setItem(
				key,
				JSON.stringify({ ownerId: this.ownerId, expiresAt: this.now() + LEASE_DURATION_MS })
			);
			return true;
		} catch {
			return false;
		}
	}

	private renewLease(key: string) {
		const current = this.readLease(key);
		if (
			current.state !== 'valid' ||
			current.lease.ownerId !== this.ownerId ||
			current.lease.expiresAt <= this.now()
		) {
			return;
		}
		this.writeLease(key);
	}

	private releaseLease(key: string) {
		if (!this.storage) return;
		const current = this.readLease(key);
		if (current.state !== 'valid' || current.lease.ownerId !== this.ownerId) return;
		try {
			this.storage.removeItem(key);
		} catch {
			// The short expiry releases an inaccessible lease without unsafe deletion.
		}
	}
}

let defaultCoordinator: BrowserExclusiveCoordinator | null = null;

export function runBrowserExclusive(name: string, task: () => Promise<void>) {
	defaultCoordinator ??= new BrowserExclusiveCoordinator();
	return defaultCoordinator.runExclusive(name, task);
}
