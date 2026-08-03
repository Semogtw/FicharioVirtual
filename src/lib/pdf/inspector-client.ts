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
	return (
		globalThis.crypto?.randomUUID?.() ?? `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`
	);
}

function validate(file: File) {
	if (file.type !== 'application/pdf' || file.size < 1 || file.size > MAX_PDF_BYTES) {
		throw new PdfInspectionError('invalid_pdf');
	}
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function invalidWorkerResponse(): never {
	throw new TypeError('Invalid PDF worker response');
}

function validPage(value: unknown, pageCount: number): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= pageCount;
}

function parsePageNumbers(data: unknown, pageCount: number): readonly number[] {
	if (!Array.isArray(data)) invalidWorkerResponse();
	const seen = new Set<number>();
	const values = data.map((value) => {
		if (!validPage(value, pageCount) || seen.has(value)) invalidWorkerResponse();
		seen.add(value);
		return value;
	});
	return Object.freeze(values);
}

function parseInspection(data: unknown): PdfInspection {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) {
		invalidWorkerResponse();
	}
	const value = data as Record<string, unknown>;
	if (
		!hasExactKeys(value, [
			'type',
			'pageCount',
			'nativePages',
			'pagesNeedingOcr',
			'ocrReasonsByPage',
			'markdown',
			'title',
			'confidence',
			'processingTimeMs',
			'layout',
			'hasEncodingIssues'
		]) ||
		(value.type !== 'TextBased' &&
			value.type !== 'Scanned' &&
			value.type !== 'ImageBased' &&
			value.type !== 'Mixed') ||
		typeof value.pageCount !== 'number' ||
		!Number.isInteger(value.pageCount) ||
		value.pageCount < 1 ||
		value.pageCount > 10_000 ||
		!Array.isArray(value.nativePages) ||
		!Array.isArray(value.ocrReasonsByPage) ||
		(value.markdown !== null &&
			(typeof value.markdown !== 'string' ||
				value.markdown.trim() !== value.markdown ||
				value.markdown.length < 1)) ||
		(value.title !== null &&
			(typeof value.title !== 'string' ||
				value.title.trim() !== value.title ||
				value.title.length < 1)) ||
		typeof value.confidence !== 'number' ||
		!Number.isFinite(value.confidence) ||
		value.confidence < 0 ||
		value.confidence > 1 ||
		typeof value.processingTimeMs !== 'number' ||
		!Number.isFinite(value.processingTimeMs) ||
		value.processingTimeMs < 0 ||
		typeof value.hasEncodingIssues !== 'boolean' ||
		value.layout === null ||
		typeof value.layout !== 'object' ||
		Array.isArray(value.layout)
	) {
		invalidWorkerResponse();
	}
	const pageCount = value.pageCount;
	const pagesNeedingOcr = parsePageNumbers(value.pagesNeedingOcr, pageCount);
	const ocrPages = new Set(pagesNeedingOcr);
	const nativePagesSeen = new Set<number>();
	const nativePages = Object.freeze(
		value.nativePages.map((entry) => {
			if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
				invalidWorkerResponse();
			}
			const record = entry as Record<string, unknown>;
			if (
				!hasExactKeys(record, ['pageNumber', 'text']) ||
				!validPage(record.pageNumber, pageCount) ||
				nativePagesSeen.has(record.pageNumber) ||
				ocrPages.has(record.pageNumber) ||
				typeof record.text !== 'string' ||
				record.text.length < 1
			) {
				invalidWorkerResponse();
			}
			nativePagesSeen.add(record.pageNumber);
			return Object.freeze({ pageNumber: record.pageNumber, text: record.text });
		})
	);
	const reasonPages = new Set<number>();
	const ocrReasonsByPage = Object.freeze(
		value.ocrReasonsByPage.map((entry) => {
			if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
				invalidWorkerResponse();
			}
			const record = entry as Record<string, unknown>;
			if (
				!hasExactKeys(record, ['pageNumber', 'reasons']) ||
				!validPage(record.pageNumber, pageCount) ||
				!ocrPages.has(record.pageNumber) ||
				reasonPages.has(record.pageNumber) ||
				!Array.isArray(record.reasons) ||
				record.reasons.some((reason) => typeof reason !== 'string')
			) {
				invalidWorkerResponse();
			}
			reasonPages.add(record.pageNumber);
			return Object.freeze({
				pageNumber: record.pageNumber,
				reasons: Object.freeze([...record.reasons] as string[])
			});
		})
	);
	const layout = value.layout as Record<string, unknown>;
	if (
		!hasExactKeys(layout, ['isComplex', 'pagesWithTables', 'pagesWithColumns']) ||
		typeof layout.isComplex !== 'boolean'
	) {
		invalidWorkerResponse();
	}
	return Object.freeze({
		type: value.type,
		pageCount,
		nativePages,
		pagesNeedingOcr,
		ocrReasonsByPage,
		markdown: value.markdown,
		title: value.title,
		confidence: value.confidence,
		processingTimeMs: value.processingTimeMs,
		layout: Object.freeze({
			isComplex: layout.isComplex,
			pagesWithTables: parsePageNumbers(layout.pagesWithTables, pageCount),
			pagesWithColumns: parsePageNumbers(layout.pagesWithColumns, pageCount)
		}),
		hasEncodingIssues: value.hasEncodingIssues
	});
}

export function parsePdfWorkerResponse(data: unknown, expectedId: string): PdfWorkerResponse {
	if (
		typeof expectedId !== 'string' ||
		expectedId.length < 1 ||
		data === null ||
		typeof data !== 'object' ||
		Array.isArray(data)
	) {
		invalidWorkerResponse();
	}
	const value = data as Record<string, unknown>;
	if (value.type === 'failure') {
		if (!hasExactKeys(value, ['type', 'id', 'code']) || value.id !== expectedId) {
			invalidWorkerResponse();
		}
		const code = value.code;
		if (code !== 'invalid_pdf' && code !== 'encrypted_pdf' && code !== 'inspection_failed') {
			invalidWorkerResponse();
		}
		return Object.freeze({ type: 'failure', id: expectedId, code });
	}
	if (
		value.type !== 'success' ||
		!hasExactKeys(value, ['type', 'id', 'inspection']) ||
		value.id !== expectedId
	) {
		invalidWorkerResponse();
	}
	return Object.freeze({
		type: 'success',
		id: expectedId,
		inspection: parseInspection(value.inspection)
	});
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
			if (task.settled) return;
			let response: PdfWorkerResponse;
			try {
				response = parsePdfWorkerResponse(event.data, task.id);
			} catch {
				this.#finish(task, new PdfInspectionError('inspection_failed'));
				return;
			}
			if (response.type === 'failure') {
				this.#finish(task, new PdfInspectionError(response.code));
				return;
			}
			this.#finish(task, null, response.inspection);
		};
		task.worker.onerror = () => this.#finish(task, new PdfInspectionError('inspection_failed'));
		try {
			task.worker.postMessage({ type: 'inspect', id: task.id, file: task.file });
		} catch {
			this.#finish(task, new PdfInspectionError('inspection_failed'));
		}
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
