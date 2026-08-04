import { Semaphore } from './semaphore';
import { listRunnableOcrJobs, type RunnableOcrJob } from '$lib/services/jobs';
import { OcrProcessingError, processPageOcr, type OcrRunResult } from '$lib/services/ocr';

const BATCH_LIMIT = 50;
const BACKOFF_DELAYS = [0, 5_000, 20_000, 60_000] as const;
const LEASE_KEY = 'fichario-ocr-runner-lease';
const LEASE_DURATION_MS = 15_000;
const LEASE_HEARTBEAT_MS = 5_000;
const LEASE_SETTLE_MS = 50;

export type OcrQueueState = 'idle' | 'running' | 'paused';

export interface OcrQueueGateway {
	listRunnableJobs(limit: number): Promise<readonly RunnableOcrJob[]>;
	processJob(pageId: string, signal: AbortSignal): Promise<OcrRunResult>;
}

export interface OcrQueueCoordinator {
	runExclusive(task: () => Promise<void>): Promise<boolean>;
	publish(state: OcrQueueState): void;
	close(): void;
}

export interface OcrQueueDelay {
	wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface OcrQueueLeaseStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface OcrQueueChannel {
	postMessage(message: unknown): void;
	close(): void;
}

type ProcessingOutcome = 'complete' | 'retry' | 'quota' | 'terminal' | 'aborted';

type LockManagerLike = {
	request(
		name: string,
		options: { mode: 'exclusive'; ifAvailable: true },
		callback: (lock: unknown | null) => Promise<void>
	): Promise<void>;
};

type QueueLease = Readonly<{
	ownerId: string;
	expiresAt: number;
}>;

type LeaseReadResult =
	| { state: 'empty' }
	| { state: 'unavailable' }
	| { state: 'invalid' }
	| { state: 'valid'; lease: QueueLease };

export type BrowserOcrQueueCoordinatorOptions = {
	ownerId?: string;
	lockManager?: LockManagerLike | null;
	storage?: OcrQueueLeaseStorage | null;
	channel?: OcrQueueChannel | null;
	now?: () => number;
	wait?: (milliseconds: number) => Promise<void>;
	setInterval?: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
	clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
};

function browserLockManager(): LockManagerLike | null {
	return typeof navigator === 'undefined'
		? null
		: ((navigator as Navigator & { locks?: LockManagerLike }).locks ?? null);
}

function browserStorage(): OcrQueueLeaseStorage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

function browserChannel(): OcrQueueChannel | null {
	return typeof BroadcastChannel === 'undefined'
		? null
		: new BroadcastChannel('fichario-imports');
}

function ownerId() {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`ocr_${Date.now()}_${Math.random().toString(36).slice(2)}`
	);
}

function wait(milliseconds: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function exactLeaseKeys(value: Record<string, unknown>) {
	const keys = Object.keys(value).sort();
	return keys.length === 2 && keys[0] === 'expiresAt' && keys[1] === 'ownerId';
}

function parseLease(value: string): QueueLease | null {
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

export class BrowserOcrQueueCoordinator implements OcrQueueCoordinator {
	private readonly ownerId: string;
	private readonly lockManager: LockManagerLike | null;
	private readonly storage: OcrQueueLeaseStorage | null;
	private readonly channel: OcrQueueChannel | null;
	private readonly now: () => number;
	private readonly wait: (milliseconds: number) => Promise<void>;
	private readonly scheduleInterval: BrowserOcrQueueCoordinatorOptions['setInterval'];
	private readonly cancelInterval: BrowserOcrQueueCoordinatorOptions['clearInterval'];

	constructor(options: BrowserOcrQueueCoordinatorOptions = {}) {
		this.ownerId = options.ownerId ?? ownerId();
		this.lockManager =
			options.lockManager === undefined ? browserLockManager() : options.lockManager;
		this.storage = options.storage === undefined ? browserStorage() : options.storage;
		this.channel = options.channel === undefined ? browserChannel() : options.channel;
		this.now = options.now ?? Date.now;
		this.wait = options.wait ?? wait;
		this.scheduleInterval = options.setInterval ?? globalThis.setInterval.bind(globalThis);
		this.cancelInterval = options.clearInterval ?? globalThis.clearInterval.bind(globalThis);
	}

	async runExclusive(task: () => Promise<void>): Promise<boolean> {
		if (this.lockManager) return this.runWithWebLock(task);
		return this.runWithStorageLease(task);
	}

	publish(state: OcrQueueState) {
		this.channel?.postMessage({ type: 'ocr-queue-state', state });
	}

	close() {
		this.channel?.close();
	}

	private async runWithWebLock(task: () => Promise<void>) {
		let acquired = false;
		await this.lockManager?.request(
			'fichario-ocr-runner',
			{ mode: 'exclusive', ifAvailable: true },
			async (lock) => {
				if (lock === null) return;
				acquired = true;
				await task();
			}
		);
		return acquired;
	}

	private async runWithStorageLease(task: () => Promise<void>) {
		if (!this.storage) {
			await task();
			return true;
		}

		const existing = this.readLease();
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
		if (!this.writeLease()) {
			await task();
			return true;
		}

		await this.wait(LEASE_SETTLE_MS);
		const confirmed = this.readLease();
		if (
			confirmed.state !== 'valid' ||
			confirmed.lease.ownerId !== this.ownerId ||
			confirmed.lease.expiresAt <= this.now()
		) {
			return false;
		}

		const heartbeat = this.scheduleInterval?.(() => this.renewLease(), LEASE_HEARTBEAT_MS);
		try {
			await task();
			return true;
		} finally {
			if (heartbeat !== undefined) this.cancelInterval?.(heartbeat);
			this.releaseLease();
		}
	}

	private readLease(): LeaseReadResult {
		if (!this.storage) return { state: 'unavailable' };
		let value: string | null;
		try {
			value = this.storage.getItem(LEASE_KEY);
		} catch {
			return { state: 'unavailable' };
		}
		if (value === null) return { state: 'empty' };
		const lease = parseLease(value);
		return lease ? { state: 'valid', lease } : { state: 'invalid' };
	}

	private writeLease() {
		if (!this.storage) return false;
		try {
			this.storage.setItem(
				LEASE_KEY,
				JSON.stringify({ ownerId: this.ownerId, expiresAt: this.now() + LEASE_DURATION_MS })
			);
			return true;
		} catch {
			return false;
		}
	}

	private renewLease() {
		const current = this.readLease();
		if (
			current.state !== 'valid' ||
			current.lease.ownerId !== this.ownerId ||
			current.lease.expiresAt <= this.now()
		) {
			return;
		}
		this.writeLease();
	}

	private releaseLease() {
		if (!this.storage) return;
		const current = this.readLease();
		if (current.state !== 'valid' || current.lease.ownerId !== this.ownerId) return;
		try {
			this.storage.removeItem(LEASE_KEY);
		} catch {
			// The short expiry releases an inaccessible lease without unsafe deletion.
		}
	}
}

const defaultDelay: OcrQueueDelay = {
	wait(milliseconds, signal) {
		if (signal.aborted) {
			return Promise.reject(new DOMException('OCR queue was paused', 'AbortError'));
		}
		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				signal.removeEventListener('abort', abort);
				resolve();
			}, milliseconds);
			const abort = () => {
				clearTimeout(timeout);
				reject(new DOMException('OCR queue was paused', 'AbortError'));
			};
			signal.addEventListener('abort', abort, { once: true });
		});
	}
};

const defaultGateway: OcrQueueGateway = {
	listRunnableJobs(limit) {
		return listRunnableOcrJobs({ limit });
	},
	processJob(pageId, signal) {
		return processPageOcr(pageId, undefined, { signal });
	}
};

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError';
}

function outcomeForResult(result: OcrRunResult): ProcessingOutcome {
	if (result.state === 'complete' || result.state === 'already_complete') return 'complete';
	if (result.state === 'quota_exhausted') return 'quota';
	return 'retry';
}

export class OcrJobRunner {
	private readonly semaphore = new Semaphore(2);
	private controller: AbortController | null = null;
	private running: Promise<void> | null = null;
	state: OcrQueueState = 'idle';

	constructor(
		private readonly gateway: OcrQueueGateway,
		private readonly coordinator: OcrQueueCoordinator,
		private readonly delay: OcrQueueDelay = defaultDelay
	) {}

	startQueue(): Promise<void> {
		if (this.running) return this.running;
		const controller = new AbortController();
		this.controller = controller;
		this.state = 'running';
		this.coordinator.publish(this.state);

		const running = this.coordinator
			.runExclusive(() => this.runRounds(controller.signal))
			.then((acquired) => {
				if (!acquired && this.state === 'running') this.state = 'idle';
			})
			.catch((error: unknown) => {
				if (!isAbortError(error) && this.state === 'running') this.state = 'idle';
			})
			.finally(() => {
				if (this.controller === controller) this.controller = null;
				if (this.running === running) this.running = null;
				if (this.state === 'running') this.state = 'idle';
				this.coordinator.publish(this.state);
			});
		this.running = running;
		return running;
	}

	resumeQueue(): Promise<void> {
		return this.startQueue();
	}

	pauseQueue() {
		this.state = 'paused';
		this.controller?.abort();
		this.coordinator.publish(this.state);
	}

	async retryJob(pageId: string): Promise<OcrRunResult> {
		const controller = this.controller ?? new AbortController();
		return this.semaphore.run(() => this.gateway.processJob(pageId, controller.signal));
	}

	close() {
		this.pauseQueue();
		this.coordinator.close();
	}

	private async runRounds(signal: AbortSignal) {
		for (const [round, delay] of BACKOFF_DELAYS.entries()) {
			if (signal.aborted) return;
			if (delay > 0) await this.delay.wait(delay, signal);
			if (signal.aborted) return;

			const jobs = await this.gateway.listRunnableJobs(BATCH_LIMIT);
			if (jobs.length === 0) return;
			const outcomes = await Promise.all(jobs.map((job) => this.process(job, signal)));
			if (signal.aborted) return;

			const retryable = outcomes.some((outcome) => outcome === 'retry');
			const fullBatch = jobs.length === BATCH_LIMIT;
			if (!retryable && !fullBatch) return;
			if (round === BACKOFF_DELAYS.length - 1) return;
		}
	}

	private process(job: RunnableOcrJob, signal: AbortSignal): Promise<ProcessingOutcome> {
		return this.semaphore.run(async () => {
			if (signal.aborted) return 'aborted';
			try {
				return outcomeForResult(await this.gateway.processJob(job.pageId, signal));
			} catch (error) {
				if (isAbortError(error) || signal.aborted) return 'aborted';
				if (error instanceof OcrProcessingError && error.retryable) return 'retry';
				return 'terminal';
			}
		});
	}
}

let defaultRunner: OcrJobRunner | null = null;

function runner() {
	defaultRunner ??= new OcrJobRunner(
		defaultGateway,
		new BrowserOcrQueueCoordinator(),
		defaultDelay
	);
	return defaultRunner;
}

export function startQueue() {
	return runner().startQueue();
}

export function pauseQueue() {
	defaultRunner?.pauseQueue();
}

export function resumeQueue() {
	return runner().resumeQueue();
}

export function retryJob(pageId: string) {
	return runner().retryJob(pageId);
}

export function closeQueue() {
	defaultRunner?.close();
	defaultRunner = null;
}
