import { Semaphore } from './semaphore';
import { listRunnableOcrJobs, type RunnableOcrJob } from '$lib/services/jobs';
import { OcrProcessingError, processPageOcr, type OcrRunResult } from '$lib/services/ocr';

const BATCH_LIMIT = 50;
const BACKOFF_DELAYS = [0, 5_000, 20_000, 60_000] as const;

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

type ProcessingOutcome = 'complete' | 'retry' | 'quota' | 'terminal' | 'aborted';

type LockManagerLike = {
	request(
		name: string,
		options: { mode: 'exclusive'; ifAvailable: true },
		callback: (lock: unknown | null) => Promise<void>
	): Promise<void>;
};

class BrowserOcrQueueCoordinator implements OcrQueueCoordinator {
	private readonly channel =
		typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('fichario-imports');

	async runExclusive(task: () => Promise<void>): Promise<boolean> {
		const lockManager =
			typeof navigator === 'undefined'
				? undefined
				: (navigator as Navigator & { locks?: LockManagerLike }).locks;
		if (!lockManager) {
			await task();
			return true;
		}

		let acquired = false;
		await lockManager.request(
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

	publish(state: OcrQueueState) {
		this.channel?.postMessage({ type: 'ocr-queue-state', state });
	}

	close() {
		this.channel?.close();
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
