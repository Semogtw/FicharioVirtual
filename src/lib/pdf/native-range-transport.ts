import {
	GlobalWorkerOptions,
	PDFDataRangeTransport,
	getDocument,
	type PDFDocumentProxy
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readNativeDocumentRange } from '$lib/native/local-document-store';

export const NATIVE_PDF_RANGE_CHUNK_BYTES = 256 * 1024;

type PdfDocumentSource = Parameters<typeof getDocument>[0];
type LoadingTaskLike = {
	promise: Promise<PDFDocumentProxy>;
	destroy(): Promise<void>;
};

type ReadRange = typeof readNativeDocumentRange;

export type NativePdfRangeDocument = Readonly<{
	document: PDFDocumentProxy;
	destroy(): Promise<void>;
}>;

export interface NativePdfRangeDependencies {
	readRange: ReadRange;
	configureWorker(): Promise<void>;
	createLoadingTask(source: PdfDocumentSource): LoadingTaskLike;
}

function validSource(documentId: string, totalBytes: number) {
	if (
		documentId.length < 1 ||
		documentId.length > 128 ||
		!Number.isSafeInteger(totalBytes) ||
		totalBytes < 1
	) {
		throw new TypeError('Invalid native PDF range source');
	}
}

export class NativePdfDataRangeTransport extends PDFDataRangeTransport {
	readonly #documentId: string;
	readonly #totalBytes: number;
	readonly #readRange: ReadRange;
	readonly #onFailure: (error: unknown) => void;
	#aborted = false;
	#failed = false;

	constructor({
		documentId,
		totalBytes,
		readRange = readNativeDocumentRange,
		onFailure
	}: {
		documentId: string;
		totalBytes: number;
		readRange?: ReadRange;
		onFailure: (error: unknown) => void;
	}) {
		validSource(documentId, totalBytes);
		super(totalBytes, new Uint8Array(0), false);
		this.#documentId = documentId;
		this.#totalBytes = totalBytes;
		this.#readRange = readRange;
		this.#onFailure = onFailure;
	}

	requestDataRange(begin: number, end: number) {
		if (this.#aborted || this.#failed) return;
		if (
			!Number.isSafeInteger(begin) ||
			!Number.isSafeInteger(end) ||
			begin < 0 ||
			end <= begin ||
			end > this.#totalBytes
		) {
			this.#fail(new TypeError('Invalid PDF.js native range request'));
			return;
		}
		void this.#readRange(this.#documentId, begin, end)
			.then((bytes) => {
				if (this.#aborted || this.#failed) {
					bytes.fill(0);
					return;
				}
				if (bytes.byteLength !== end - begin) {
					bytes.fill(0);
					this.#fail(new Error('Native PDF range length mismatch'));
					return;
				}
				this.onDataRange(begin, bytes);
			})
			.catch((error) => this.#fail(error));
	}

	abort() {
		this.#aborted = true;
	}

	#fail(error: unknown) {
		if (this.#aborted || this.#failed) return;
		this.#failed = true;
		this.#onFailure(error);
	}
}

export class NativePdfRangeError extends Error {
	constructor() {
		super('Não foi possível ler o PDF pelo armazenamento local.');
		this.name = 'NativePdfRangeError';
	}
}

async function configurePdfWorker() {
	const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
	GlobalWorkerOptions.workerSrc = workerModule.default;
}

const defaultDependencies: NativePdfRangeDependencies = {
	readRange: readNativeDocumentRange,
	configureWorker: configurePdfWorker,
	createLoadingTask: getDocument
};

export async function openNativePdfRangeDocument({
	documentId,
	totalBytes,
	dependencies = defaultDependencies
}: {
	documentId: string;
	totalBytes: number;
	dependencies?: NativePdfRangeDependencies;
}): Promise<NativePdfRangeDocument> {
	validSource(documentId, totalBytes);
	let loadingTask: LoadingTaskLike | null = null;
	let destroyed = false;
	let rejectRangeFailure: (error: unknown) => void = () => undefined;
	const rangeFailure = new Promise<never>((_resolve, reject) => {
		rejectRangeFailure = reject;
	});
	const transport = new NativePdfDataRangeTransport({
		documentId,
		totalBytes,
		readRange: dependencies.readRange,
		onFailure(error) {
			rejectRangeFailure(error);
			void destroyLoadingTask();
		}
	});

	async function destroyLoadingTask() {
		if (destroyed) return;
		destroyed = true;
		transport.abort();
		await loadingTask?.destroy().catch(() => undefined);
	}

	try {
		await dependencies.configureWorker();
		loadingTask = dependencies.createLoadingTask({
			range: transport,
			rangeChunkSize: NATIVE_PDF_RANGE_CHUNK_BYTES,
			disableRange: false,
			disableStream: true,
			disableAutoFetch: true
		});
		const document = await Promise.race([loadingTask.promise, rangeFailure]);
		return Object.freeze({ document, destroy: destroyLoadingTask });
	} catch {
		await destroyLoadingTask();
		throw new NativePdfRangeError();
	}
}
