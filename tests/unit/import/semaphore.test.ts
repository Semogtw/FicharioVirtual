import { describe, expect, it, vi } from 'vitest';
import { Semaphore } from '../../../src/lib/import/semaphore';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

describe('Semaphore', () => {
	it('limits concurrent work and releases queued tasks in order', async () => {
		const semaphore = new Semaphore(2);
		const releases = [deferred(), deferred(), deferred(), deferred()];
		let active = 0;
		let maximum = 0;
		const started: number[] = [];

		const tasks = releases.map((release, index) =>
			semaphore.run(async () => {
				active += 1;
				maximum = Math.max(maximum, active);
				started.push(index);
				await release.promise;
				active -= 1;
				return index;
			})
		);

		await vi.waitFor(() => expect(started).toEqual([0, 1]));
		releases[0]?.resolve();
		await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
		releases[1]?.resolve();
		await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
		releases[2]?.resolve();
		releases[3]?.resolve();

		await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3]);
		expect(maximum).toBe(2);
	});

	it('rejects invalid concurrency limits', () => {
		expect(() => new Semaphore(0)).toThrow(TypeError);
		expect(() => new Semaphore(1.5)).toThrow(TypeError);
	});
});
