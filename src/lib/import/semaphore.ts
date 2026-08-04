type QueueEntry = {
	start: () => void;
};

export class Semaphore {
	private active = 0;
	private readonly queue: QueueEntry[] = [];

	constructor(private readonly limit: number) {
		if (!Number.isInteger(limit) || limit < 1) {
			throw new TypeError('Semaphore limit must be a positive integer');
		}
	}

	async run<T>(task: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await task();
		} finally {
			this.release();
		}
	}

	private acquire(): Promise<void> {
		if (this.active < this.limit) {
			this.active += 1;
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			this.queue.push({
				start: () => {
					this.active += 1;
					resolve();
				}
			});
		});
	}

	private release() {
		this.active -= 1;
		const next = this.queue.shift();
		next?.start();
	}
}
