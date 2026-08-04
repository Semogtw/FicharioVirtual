const POLL_INTERVAL_MS = 5 * 60_000;

export interface OcrQueueLifecycleTarget {
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

export type OcrQueueLifecycleOptions = {
	onlineTarget?: OcrQueueLifecycleTarget | null;
	visibilityTarget?: OcrQueueLifecycleTarget | null;
	visibilityState?: () => string;
	isOnline?: () => boolean;
	setInterval?: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
	clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
};

export type OcrQueueLifecycle = Readonly<{
	start(): void;
	stop(): void;
}>;

function browserOnlineTarget(): OcrQueueLifecycleTarget | null {
	return typeof window === 'undefined' ? null : (window as unknown as OcrQueueLifecycleTarget);
}

function browserVisibilityTarget(): OcrQueueLifecycleTarget | null {
	return typeof document === 'undefined'
		? null
		: (document as unknown as OcrQueueLifecycleTarget);
}

function browserVisibilityState() {
	return typeof document === 'undefined' ? 'visible' : document.visibilityState;
}

function browserOnlineState() {
	return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function createOcrQueueLifecycle(
	resume: () => void | Promise<void>,
	options: OcrQueueLifecycleOptions = {}
): OcrQueueLifecycle {
	const onlineTarget =
		options.onlineTarget === undefined ? browserOnlineTarget() : options.onlineTarget;
	const visibilityTarget =
		options.visibilityTarget === undefined
			? browserVisibilityTarget()
			: options.visibilityTarget;
	const visibilityState = options.visibilityState ?? browserVisibilityState;
	const isOnline = options.isOnline ?? browserOnlineState;
	const scheduleInterval =
		options.setInterval ??
		((callback: () => void, milliseconds: number) =>
			globalThis.setInterval(callback, milliseconds));
	const cancelInterval =
		options.clearInterval ??
		((handle: ReturnType<typeof setInterval>) => globalThis.clearInterval(handle));
	let active = false;
	let pollHandle: ReturnType<typeof setInterval> | undefined;

	function trigger() {
		if (!active) return;
		try {
			void Promise.resolve(resume()).catch(() => undefined);
		} catch {
			// A later lifecycle signal retries a synchronous integration failure.
		}
	}

	function onOnline() {
		trigger();
	}

	function onVisibilityChange() {
		if (visibilityState() === 'visible') trigger();
	}

	function onPoll() {
		if (visibilityState() === 'visible' && isOnline()) trigger();
	}

	return Object.freeze({
		start() {
			if (active) return;
			active = true;
			onlineTarget?.addEventListener('online', onOnline);
			visibilityTarget?.addEventListener('visibilitychange', onVisibilityChange);
			pollHandle = scheduleInterval(onPoll, POLL_INTERVAL_MS);
			trigger();
		},
		stop() {
			if (!active) return;
			active = false;
			onlineTarget?.removeEventListener('online', onOnline);
			visibilityTarget?.removeEventListener('visibilitychange', onVisibilityChange);
			if (pollHandle !== undefined) cancelInterval(pollHandle);
			pollHandle = undefined;
		}
	});
}
