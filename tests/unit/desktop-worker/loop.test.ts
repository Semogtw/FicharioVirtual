import { describe, expect, it, vi } from 'vitest';
import { nextWorkerDelay, runWorkerLoop } from '../../../tools/desktop-worker/loop.mjs';

const config = {
	pollIntervalSeconds: 10,
	idlePollIntervalSeconds: 80,
	keepCompletedSpoolHours: 24
};

describe('nextWorkerDelay', () => {
	it('uses slow idle polling, normal active polling, and capped exponential retry backoff', () => {
		expect(nextWorkerDelay('idle', 0, config)).toBe(80_000);
		expect(nextWorkerDelay('completed', 0, config)).toBe(10_000);
		expect(nextWorkerDelay('claim_deferred', 1, config)).toBe(10_000);
		expect(nextWorkerDelay('claim_deferred', 2, config)).toBe(20_000);
		expect(nextWorkerDelay('claim_deferred', 3, config)).toBe(40_000);
		expect(nextWorkerDelay('claim_deferred', 4, config)).toBe(80_000);
		expect(nextWorkerDelay('claim_deferred', 10, config)).toBe(80_000);
	});

	it('rejects invalid or unexpectedly faster idle polling configuration', () => {
		expect(() =>
			nextWorkerDelay('idle', 0, {
				...config,
				idlePollIntervalSeconds: 5
			})
		).toThrow('idle polling');
		expect(() => nextWorkerDelay('unknown', 0, config)).toThrow('Unknown');
	});
});

describe('runWorkerLoop', () => {
	it('serializes cycles and resets retry backoff after a healthy cycle', async () => {
		const runCycle = vi
			.fn()
			.mockResolvedValueOnce({ status: 'claim_deferred', code: 'worker_network_failed' })
			.mockResolvedValueOnce({ status: 'claim_deferred', code: 'worker_network_failed' })
			.mockResolvedValueOnce({ status: 'completed' })
			.mockResolvedValueOnce({ status: 'idle' });
		const sleep = vi.fn(async () => undefined);
		const statuses: unknown[] = [];

		const result = await runWorkerLoop({ marker: true }, config, {
			runCycle,
			sleep,
			onStatus: (status) => statuses.push(status),
			maxCycles: 4
		});

		expect(runCycle).toHaveBeenCalledTimes(4);
		expect(runCycle).toHaveBeenNthCalledWith(
			1,
			{ marker: true },
			{
				signal: undefined,
				keepCompletedSpoolHours: 24
			}
		);
		expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([10_000, 20_000, 10_000]);
		expect(statuses).toEqual([
			{ cycle: 1, status: 'claim_deferred', consecutiveFailures: 1, code: 'worker_network_failed' },
			{ cycle: 2, status: 'claim_deferred', consecutiveFailures: 2, code: 'worker_network_failed' },
			{ cycle: 3, status: 'completed', consecutiveFailures: 0, code: null },
			{ cycle: 4, status: 'idle', consecutiveFailures: 0, code: null }
		]);
		expect(result).toEqual({ cycles: 4, consecutiveFailures: 0 });
	});

	it('uses idle polling after an empty queue without treating it as a failure', async () => {
		const runCycle = vi
			.fn()
			.mockResolvedValueOnce({ status: 'idle' })
			.mockResolvedValueOnce({ status: 'idle' });
		const sleep = vi.fn(async () => undefined);

		const result = await runWorkerLoop({}, config, { runCycle, sleep, maxCycles: 2 });

		expect(sleep).toHaveBeenCalledOnce();
		expect(sleep).toHaveBeenCalledWith(80_000, undefined);
		expect(result.consecutiveFailures).toBe(0);
	});

	it('stops before starting another cycle when shutdown aborts during sleep', async () => {
		const controller = new AbortController();
		const runCycle = vi.fn(async () => ({ status: 'idle' }));
		const sleep = vi.fn(async (_delay, signal: AbortSignal | undefined) => {
			controller.abort(new DOMException('shutdown', 'AbortError'));
			throw signal?.reason;
		});

		await expect(
			runWorkerLoop({}, config, { signal: controller.signal, runCycle, sleep })
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(runCycle).toHaveBeenCalledOnce();
	});

	it('does not leak arbitrary cycle details through the status callback', async () => {
		const onStatus = vi.fn();
		await runWorkerLoop({}, config, {
			runCycle: vi.fn(async () => ({
				status: 'source_deferred',
				code: 'source_hash_mismatch',
				jobId: 'private-job-id',
				replay: { private: 'payload' }
			})),
			onStatus,
			maxCycles: 1
		});

		expect(onStatus).toHaveBeenCalledWith({
			cycle: 1,
			status: 'source_deferred',
			consecutiveFailures: 1,
			code: 'source_hash_mismatch'
		});
	});
});
