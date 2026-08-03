export type LatestSerialExecutor<T> = {
	enqueue(value: T): Promise<void>;
};

export function createLatestSerialExecutor<T>(
	execute: (value: T) => Promise<void>
): LatestSerialExecutor<T> {
	let pending: { value: T } | null = null;
	let running: Promise<void> | null = null;

	async function drain() {
		while (pending !== null) {
			const current = pending;
			pending = null;
			await execute(current.value);
		}
	}

	return Object.freeze({
		enqueue(value: T) {
			pending = { value };
			running ??= drain().finally(() => {
				running = null;
			});
			return running;
		}
	});
}
