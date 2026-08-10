import { describe, expect, it, vi } from 'vitest';
import {
	OcrJobRunner,
	type OcrQueueCoordinator,
	type OcrQueueGateway
} from '../../../src/lib/import/job-runner';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

function coordinator(acquired = true): OcrQueueCoordinator {
	return {
		async runExclusive(task) {
			if (!acquired) return false;
			await task();
			return true;
		},
		publish: vi.fn(),
		close: vi.fn()
	};
}

const jobs = [1, 2, 3, 4, 5].map((number) => ({
	pageId: `00000000-0000-4000-8000-00000000000${number}`,
	attemptCount: 0
}));

describe('OcrJobRunner', () => {
	it('processes at most two OCR jobs concurrently', async () => {
		let active = 0;
		let maximum = 0;
		const gateway: OcrQueueGateway = {
			listRunnableJobs: vi.fn().mockResolvedValueOnce(jobs),
			processJob: vi.fn(async () => {
				active += 1;
				maximum = Math.max(maximum, active);
				await Promise.resolve();
				active -= 1;
				return { state: 'complete' as const, needsReview: false, warningCount: 0 };
			})
		};
		const runner = new OcrJobRunner(gateway, coordinator(), {
			wait: vi.fn(async () => undefined)
		});

		await runner.startQueue();

		expect(gateway.processJob).toHaveBeenCalledTimes(5);
		expect(maximum).toBeLessThanOrEqual(2);
	});

	it('does not inspect or process jobs when another tab owns the lock', async () => {
		const gateway: OcrQueueGateway = {
			listRunnableJobs: vi.fn(),
			processJob: vi.fn()
		};
		const runner = new OcrJobRunner(gateway, coordinator(false));

		await runner.startQueue();

		expect(gateway.listRunnableJobs).not.toHaveBeenCalled();
		expect(gateway.processJob).not.toHaveBeenCalled();
	});

	it('aborts active work and does not start queued jobs after pause', async () => {
		const started: string[] = [];
		const releases = [deferred(), deferred()];
		const gateway: OcrQueueGateway = {
			listRunnableJobs: vi.fn().mockResolvedValueOnce(jobs),
			processJob: vi.fn(async (pageId, signal) => {
				started.push(pageId);
				await new Promise<void>((resolve, reject) => {
					const release = releases[started.length - 1];
					const abort = () => reject(new DOMException('cancelled', 'AbortError'));
					signal.addEventListener('abort', abort, { once: true });
					void release?.promise.then(resolve);
				});
				return { state: 'complete' as const, needsReview: false, warningCount: 0 };
			})
		};
		const runner = new OcrJobRunner(gateway, coordinator());

		const running = runner.startQueue();
		await vi.waitFor(() => expect(started).toHaveLength(2));
		runner.pauseQueue();
		await running;

		expect(started).toHaveLength(2);
		expect(runner.state).toBe('paused');
	});

	it('keeps a deferred retry alive while database polls are temporarily empty', async () => {
		const wait = vi.fn(async () => undefined);
		const gateway: OcrQueueGateway = {
			listRunnableJobs: vi
				.fn()
				.mockResolvedValueOnce([jobs[0]])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([jobs[0]]),
			processJob: vi
				.fn()
				.mockResolvedValueOnce({ state: 'retry_later' as const })
				.mockResolvedValueOnce({ state: 'complete' as const, needsReview: false, warningCount: 0 })
		};
		const runner = new OcrJobRunner(gateway, coordinator(), { wait });

		await runner.startQueue();

		expect(wait.mock.calls.map(([delay]) => delay)).toEqual([5_000, 20_000, 60_000]);
		expect(gateway.listRunnableJobs).toHaveBeenCalledTimes(4);
		expect(gateway.processJob).toHaveBeenCalledTimes(2);
		expect(gateway.processJob).toHaveBeenNthCalledWith(1, jobs[0].pageId, expect.any(AbortSignal));
		expect(gateway.processJob).toHaveBeenNthCalledWith(2, jobs[0].pageId, expect.any(AbortSignal));
	});

	it('does not loop automatically after a daily quota result', async () => {
		const wait = vi.fn(async () => undefined);
		const gateway: OcrQueueGateway = {
			listRunnableJobs: vi.fn().mockResolvedValueOnce([jobs[0]]),
			processJob: vi.fn(async () => ({ state: 'quota_exhausted' as const }))
		};
		const runner = new OcrJobRunner(gateway, coordinator(), { wait });

		await runner.startQueue();

		expect(wait).not.toHaveBeenCalled();
		expect(gateway.listRunnableJobs).toHaveBeenCalledOnce();
	});

	it('closes cross-tab resources when disposed', () => {
		const crossTab = coordinator();
		const runner = new OcrJobRunner({ listRunnableJobs: vi.fn(), processJob: vi.fn() }, crossTab);

		runner.close();

		expect(crossTab.close).toHaveBeenCalledOnce();
		expect(runner.state).toBe('paused');
	});
});
