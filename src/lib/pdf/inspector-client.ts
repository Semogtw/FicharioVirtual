import type { PdfInspection, PdfWorkerRequest, PdfWorkerResponse } from './types';

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export interface PdfWorkerLike {
	onmessage: ((event: MessageEvent<PdfWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(request: PdfWorkerRequest): void;
	terminate(): void;
}

type Task = {
	id: string;
	file: File;
	signal?: AbortSignal;
	resolve: (inspection: PdfInspection) => void;
	reject: (reason: unknown) => void;
	worker: PdfWorkerLike | null;
	settled: boolean;
	started: boolean;
	onAbort: () => void;
};

export class PdfInspectionError extends Error {
	readonly code: 'invalid_pdf' | 'encrypted_pdf' | 'inspection_failed';

	constructor(code: PdfInspectionError['code']) {
		const messages = {
			invalid_pdf: 'Selecione um PDF válido de até 20 MB.',
			encrypted_pdf: 'Este PDF exige senha e ainda não pode ser importado.',
			inspection_failed: 'Não foi possível analisar este PDF no dispositivo.'
		} as const;
		super(messages[code]);
		this.name = 'PdfInspectionError';
		this.code = code;
	}
}

function abortError() {
	return new DOMException('PDF inspection was cancelled', 'AbortError');
}

function id() {
	return globalThis.crypto?.randomUUID?.() ?? `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function validate(file: File) {
	if (file.type !== 'application/pdf' || file.size < 1 || file.size > MAX_PDF_BYTES) {
		throw new PdfInspectionError('invalid_pdf');
	}
}

export class PdfInspectionClient {
	readonly #queue: Task[] = [];
	readonly #factory: () => PdfWorkerLike;
	readonly #maxConcurrency: number;
	#active = 0;

	constructor(
		factory: () => PdfWorkerLike = () =>
			new Worker(new URL('./inspector-worker.ts', import.meta.url), { type: 'module' }),
		maxConcurrency = 1
	) {
		if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 2) {
			throw new TypeError('Invalid PDF inspection concurrency');
		}
		this.#factory = factory;
		this.#maxConcurrency = maxConcurrency;
	}

	inspect(file: File, options: { signal?: AbortSignal } = {}): Promise<PdfInspection> {
		validate(file);
		if (options.signal?.aborted) return Promise.reject(abortError());
		return new Promise((resolve, reject) => {
			const task: Task = {
				id: id(),
				file,
				signal: options.signal,
				resolve,
				reject,
				worker: null,
				settled: false,
				started: false,
				onAbort: () => this.#abort(task)
			};
			options.signal?.addEventListener('abort', task.onAbort, { once: true });
			this.#queue.push(task);
			this.#pump();
		});
	}

	#pump() {
		while (this.#active < this.#maxConcurrency && this.#queue.length > 0) {
			const task = this.#queue.shift();
			if (!task || task.settled) continue;
			this.#start(task);
		}
	}

	#start(task: Task) {
		task.started = true;
		this.#active += 1;
		try {
			task.worker = this.#factory();
		} catch {
			this.#finish(task, new PdfInspectionError('inspection_failed'));
			return;
		}
		task.worker.onmessage = (event) => {
			if (event.data.id !== task.id || task.settled) return;
			if (event.data.type === 'failure') {
				this.#finish(task, new PdfInspectionError(event.data.code));
				return;
			}
			this.#finish(task, null, event.data.inspection);
		};
		task.worker.onerror = () => this.#finish(task, new PdfInspectionError('inspection_failed'));
		task.worker.postMessage({ type: 'inspect', id: task.id, file: task.file });
	}

	#abort(task: Task) {
		if (task.settled) return;
		if (!task.started) {
			const index = this.#queue.indexOf(task);
			if (index >= 0) this.#queue.splice(index, 1);
			task.settled = true;
			task.signal?.removeEventListener('abort', task.onAbort);
			task.reject(abortError());
			return;
		}
		this.#finish(task, abortError());
	}

	#finish(task: Task, error: unknown | null, inspection?: PdfInspection) {
		if (task.settled) return;
		task.settled = true;
		task.signal?.removeEventListener('abort', task.onAbort);
		task.worker?.terminate();
		task.worker = null;
		if (task.started) this.#active = Math.max(0, this.#active - 1);
		if (error !== null) task.reject(error);
		else if (inspection) task.resolve(inspection);
		else task.reject(new PdfInspectionError('inspection_failed'));
		this.#pump();
	}
}

let sharedClient: PdfInspectionClient | null = null;

export function inspectPdf(file: File, options: { signal?: AbortSignal } = {}) {
	sharedClient ??= new PdfInspectionClient();
	return sharedClient.inspect(file, options);
}
