import { describe, expect, it } from 'vitest';
import { createLatestSerialExecutor } from '../../../src/lib/review/latest-serial-executor';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

describe('createLatestSerialExecutor', () => {
	it('never overlaps work and coalesces pending values to the latest one', async () => {
		const first = deferred();
		const started: string[] = [];
		let active = 0;
		let maximum = 0;
		const executor = createLatestSerialExecutor<string>(async (value) => {
			active += 1;
			maximum = Math.max(maximum, active);
			started.push(value);
			if (value === 'first') await first.promise;
			active -= 1;
		});

		const firstRun = executor.enqueue('first');
		await Promise.resolve();
		const secondRun = executor.enqueue('second');
		const thirdRun = executor.enqueue('third');

		expect(started).toEqual(['first']);
		first.resolve();
		await Promise.all([firstRun, secondRun, thirdRun]);

		expect(started).toEqual(['first', 'third']);
		expect(maximum).toBe(1);
	});

	it('continues with the latest pending value when one execution handles its own failure', async () => {
		const first = deferred();
		const completed: string[] = [];
		const executor = createLatestSerialExecutor<string>(async (value) => {
			if (value === 'first') await first.promise;
			completed.push(value);
		});

		const running = executor.enqueue('first');
		await Promise.resolve();
		executor.enqueue('latest');
		first.resolve();
		await running;

		expect(completed).toEqual(['first', 'latest']);
	});
});
