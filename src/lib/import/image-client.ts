import type {
	ImagePreparationMode,
	ImagePreparationOptions,
	ImageWorkerRequest,
	ImageWorkerResponse,
	PreparedImage
} from './image-types';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ImageWorkerLike {
	onmessage: ((event: MessageEvent<ImageWorkerResponse>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(request: ImageWorkerRequest): void;
	terminate(): void;
}

type QueuedTask = {
	id: string;
	file: File;
	mode: ImagePreparationMode;
	signal?: AbortSignal;
	resolve: (value: PreparedImage) => void;
	reject: (reason: unknown) => void;
	worker: ImageWorkerLike | null;
	started: boolean;
	settled: boolean;
	onAbort: () => void;
};

export class ImagePreparationError extends Error {
	readonly code:
		| 'invalid_image'
		| 'image_too_large'
		| 'decode_failed'
		| 'encode_failed'
		| 'worker_failed';

	constructor(code: ImagePreparationError['code']) {
		const messages = {
			invalid_image: 'Selecione uma imagem JPG, PNG ou WebP válida.',
			image_too_large: 'A imagem deve ter no máximo 12 MB antes da preparação.',
			decode_failed: 'Não foi possível abrir esta imagem.',
			encode_failed: 'Não foi possível preparar esta imagem.',
			worker_failed: 'A preparação da imagem foi interrompida.'
		} as const;
		super(messages[code]);
		this.name = 'ImagePreparationError';
		this.code = code;
	}
}

function abortError() {
	return new DOMException('Image preparation was cancelled', 'AbortError');
}

function taskId() {
	return globalThis.crypto?.randomUUID?.() ?? `image_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function profile(mode: ImagePreparationMode) {
	return mode === 'high-definition'
		? ({ maxDimension: 3200, quality: 0.88 } as const)
		: ({ maxDimension: 2560, quality: 0.85 } as const);
}

function validateImage(file: File) {
	if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size < 1) {
		throw new ImagePreparationError('invalid_image');
	}
	if (file.size > MAX_IMAGE_BYTES) throw new ImagePreparationError('image_too_large');
}

export class ImagePreparationClient {
	readonly #queue: QueuedTask[] = [];
	readonly #workerFactory: () => ImageWorkerLike;
	readonly #maxConcurrency: number;
	#active = 0;

	constructor(
		workerFactory: () => ImageWorkerLike = () =>
			new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' }),
		maxConcurrency = 2
	) {
		if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 4) {
			throw new TypeError('Invalid image worker concurrency');
		}
		this.#workerFactory = workerFactory;
		this.#maxConcurrency = maxConcurrency;
	}

	prepare(
		file: File,
		mode: ImagePreparationMode = 'standard',
		options: ImagePreparationOptions = {}
	): Promise<PreparedImage> {
		validateImage(file);
		if (mode !== 'standard' && mode !== 'high-definition') {
			throw new TypeError('Invalid image preparation mode');
		}
		if (options.signal?.aborted) return Promise.reject(abortError());

		return new Promise<PreparedImage>((resolve, reject) => {
			const task: QueuedTask = {
				id: taskId(),
				file,
				mode,
				signal: options.signal,
				resolve,
				reject,
				worker: null,
				started: false,
				settled: false,
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

	#start(task: QueuedTask) {
		task.started = true;
		this.#active += 1;
		let worker: ImageWorkerLike;
		try {
			worker = this.#workerFactory();
		} catch {
			this.#finish(task, new ImagePreparationError('worker_failed'));
			return;
		}
		task.worker = worker;

		worker.onmessage = (event) => {
			if (task.settled || event.data.id !== task.id) return;
			if (event.data.type === 'failure') {
				const code =
					event.data.code === 'decode_failed'
						? 'decode_failed'
						: event.data.code === 'encode_failed'
							? 'encode_failed'
							: 'worker_failed';
				this.#finish(task, new ImagePreparationError(code));
				return;
			}
			this.#finish(task, null, {
				image: event.data.image,
				thumbnail: event.data.thumbnail,
				width: event.data.width,
				height: event.data.height,
				format: event.data.format,
				originalName: task.file.name,
				originalBytes: task.file.size,
				preparedBytes: event.data.image.size + event.data.thumbnail.size
			});
		};
		worker.onerror = () => {
			this.#finish(task, new ImagePreparationError('worker_failed'));
		};

		const selected = profile(task.mode);
		worker.postMessage({
			type: 'prepare',
			id: task.id,
			file: task.file,
			maxDimension: selected.maxDimension,
			thumbnailDimension: 480,
			quality: selected.quality
		});
	}

	#abort(task: QueuedTask) {
		if (task.settled) return;
		if (!task.started) {
			const index = this.#queue.indexOf(task);
			if (index >= 0) this.#queue.splice(index, 1);
			task.settled = true;
			task.signal?.removeEventListener('abort', task.onAbort);
			task.reject(abortError());
			this.#pump();
			return;
		}
		this.#finish(task, abortError());
	}

	#finish(task: QueuedTask, error: unknown | null, value?: PreparedImage) {
		if (task.settled) return;
		task.settled = true;
		task.signal?.removeEventListener('abort', task.onAbort);
		task.worker?.terminate();
		task.worker = null;
		if (task.started) this.#active = Math.max(0, this.#active - 1);
		if (error !== null) task.reject(error);
		else if (value) task.resolve(Object.freeze(value));
		else task.reject(new ImagePreparationError('worker_failed'));
		this.#pump();
	}
}

let sharedClient: ImagePreparationClient | null = null;

export function prepareImage(
	file: File,
	mode: ImagePreparationMode = 'standard',
	options: ImagePreparationOptions = {}
): Promise<PreparedImage> {
	sharedClient ??= new ImagePreparationClient();
	return sharedClient.prepare(file, mode, options);
}
