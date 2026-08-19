import { BrowserExclusiveCoordinator } from './browser-exclusive';
import type {
	BrowserExclusiveCoordinatorOptions,
	BrowserExclusiveStorage
} from './browser-exclusive';
import { Semaphore } from './semaphore';
import { listRunnableOcrJobs, type RunnableOcrJob } from '$lib/services/jobs';
import { processPageOcr, type OcrRunResult } from '$lib/services/ocr';

const BATCH_LIMIT = 50;

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

export type OcrQueueLeaseStorage = BrowserExclusiveStorage;

export interface OcrQueueChannel {
	postMessage(message: unknown): void;
	close(): void;
}

type ProcessingOutcome = 'complete' | 'terminal' | 'aborted';

export type BrowserOcrQueueCoordinatorOptions = BrowserExclusiveCoordinatorOptions & {
	channel?: OcrQueueChannel | null;
};

function browserChannel(): OcrQueueChannel | null {
	return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('fichario-imports');
}

export class BrowserOcrQueueCoordinator implements OcrQueueCoordinator {
	private readonly exclusive: BrowserExclusiveCoordinator;
	private readonly channel: OcrQueueChannel | null;

	constructor(options: BrowserOcrQueueCoordinatorOptions = {}) {
		const { channel, ...exclusiveOptions } = options;
		this.exclusive = new BrowserExclusiveCoordinator(exclusiveOptions);
		this.channel = channel === undefined ? browserChannel() : channel;
	}

	runExclusive(task: () => Promise<void>): Promise<boolean> {
		return this.exclusive.runExclusive('fichario-ocr-runner', task);
	}

	publish(state: OcrQueueState) {
		this.channel?.postMessage({ type: 'ocr-queue-state', state });
	}

	close() {
		this.channel?.close();
	}
}

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
	return result.state === 'complete' ? 'complete' : 'terminal';
}

export class OcrJobRunner {
	private readonly semaphore = new Semaphore(2);
	private controller: AbortController | null = null;
	private running: Promise<void> | null = null;
	state: OcrQueueState = 'idle';

	constructor(
		private readonly gateway: OcrQueueGateway,
		private readonly coordinator: OcrQueueCoordinator
	) {}

	startQueue(): Promise<void> {
		if (this.running) return this.running;
		const controller = new AbortController();
		this.controller = controller;
		this.state = 'running';
		this.coordinator.publish(this.state);

		const running = this.coordinator
			.runExclusive(() => this.runAvailableJobs(controller.signal))
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

	private async runAvailableJobs(signal: AbortSignal) {
		if (signal.aborted) return;
		const jobs = await this.gateway.listRunnableJobs(BATCH_LIMIT);
		if (jobs.length === 0 || signal.aborted) return;
		await Promise.all(jobs.map((job) => this.process(job, signal)));
	}

	private process(job: RunnableOcrJob, signal: AbortSignal): Promise<ProcessingOutcome> {
		return this.semaphore.run(async () => {
			if (signal.aborted) return 'aborted';
			try {
				return outcomeForResult(await this.gateway.processJob(job.pageId, signal));
			} catch (error) {
				if (isAbortError(error) || signal.aborted) return 'aborted';
				return 'terminal';
			}
		});
	}
}

let defaultRunner: OcrJobRunner | null = null;

function runner() {
	defaultRunner ??= new OcrJobRunner(defaultGateway, new BrowserOcrQueueCoordinator());
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
