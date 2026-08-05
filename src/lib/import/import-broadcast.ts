export type ImportBroadcastUpdate = Readonly<{
	type: 'image-import-updated' | 'pdf-import-updated';
	id: string;
	status: string;
}>;

export interface ImportBroadcastChannel {
	postMessage(message: unknown): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	close(): void;
}

const LOCAL_ID = /^[A-Za-z0-9_-]{1,160}$/;
const STATUS = /^[a-z][a-z0-9_]{0,63}$/;

function parseUpdate(data: unknown): ImportBroadcastUpdate | null {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
	const record = data as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (keys.length !== 3 || keys[0] !== 'id' || keys[1] !== 'status' || keys[2] !== 'type') {
		return null;
	}
	const { type, id, status } = record;
	if (
		(type !== 'image-import-updated' && type !== 'pdf-import-updated') ||
		typeof id !== 'string' ||
		!LOCAL_ID.test(id) ||
		typeof status !== 'string' ||
		!STATUS.test(status)
	) {
		return null;
	}
	return Object.freeze({ type, id, status });
}

function browserChannel(): ImportBroadcastChannel | null {
	return typeof window === 'undefined' || typeof BroadcastChannel === 'undefined'
		? null
		: new BroadcastChannel('fichario-imports');
}

type ImportBroadcastErrorHandler = (error: unknown) => void;

function reportListenerError(error: unknown) {
	const reporter = (globalThis as { reportError?: ImportBroadcastErrorHandler }).reportError;
	reporter?.(error);
}

export class ImportBroadcastCoordinator {
	private readonly listeners = new Set<(update: ImportBroadcastUpdate) => void>();
	private readonly onMessage = (event: MessageEvent<unknown>) => {
		const update = parseUpdate(event.data);
		if (!update) return;
		for (const listener of this.listeners) {
			try {
				listener(update);
			} catch (error) {
				this.onListenerError(error);
			}
		}
	};

	constructor(
		private readonly channel: ImportBroadcastChannel | null = browserChannel(),
		private readonly onListenerError: ImportBroadcastErrorHandler = reportListenerError
	) {
		this.channel?.addEventListener('message', this.onMessage);
	}

	publish(update: ImportBroadcastUpdate) {
		this.channel?.postMessage(update);
	}

	subscribe(listener: (update: ImportBroadcastUpdate) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	close() {
		this.listeners.clear();
		this.channel?.removeEventListener('message', this.onMessage);
		this.channel?.close();
	}
}

let defaultCoordinator: ImportBroadcastCoordinator | null = null;

function coordinator() {
	defaultCoordinator ??= new ImportBroadcastCoordinator();
	return defaultCoordinator;
}

export function publishImportUpdate(update: ImportBroadcastUpdate) {
	coordinator().publish(update);
}

export function subscribeImportUpdates(listener: (update: ImportBroadcastUpdate) => void) {
	return coordinator().subscribe(listener);
}
