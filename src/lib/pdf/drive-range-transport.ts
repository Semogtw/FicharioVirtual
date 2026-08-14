import {
	GlobalWorkerOptions,
	PDFDataRangeTransport,
	getDocument,
	type PDFDocumentProxy
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
	downloadBrowserDriveRange,
	type DriveMediaClientLike
} from '$lib/drive/browser-download';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
export const DRIVE_PDF_RANGE_CHUNK_BYTES = 256 * 1024;

type DownloadRange = typeof downloadBrowserDriveRange;
type PdfDocumentSource = Parameters<typeof getDocument>[0];
type LoadingTaskLike = {
	promise: Promise<PDFDocumentProxy>;
	destroy(): Promise<void>;
};

export type DrivePdfRangeDocument = Readonly<{
	document: PDFDocumentProxy;
	destroy(): Promise<void>;
}>;

export interface DrivePdfRangeDependencies {
	downloadRange: DownloadRange;
	configureWorker(): Promise<void>;
	createLoadingTask(source: PdfDocumentSource): LoadingTaskLike;
}

function validSource(fileId: string, totalBytes: number) {
	if (!DRIVE_ID.test(fileId) || !Number.isSafeInteger(totalBytes) || totalBytes < 1) {
		throw new TypeError('Invalid Drive PDF range source');
	}
}

export class DrivePdfDataRangeTransport extends PDFDataRangeTransport {
	readonly #client: DriveMediaClientLike;
	readonly #fileId: string;
	readonly #totalBytes: number;
	readonly #downloadRange: DownloadRange;
	readonly #onFailure: (error: unknown) => void;
	#aborted = false;
	#failed = false;

	constructor({
		client,
		fileId,
		totalBytes,
		downloadRange = downloadBrowserDriveRange,
		onFailure
	}: {
		client: DriveMediaClientLike;
		fileId: string;
		totalBytes: number;
		downloadRange?: DownloadRange;
		onFailure: (error: unknown) => void;
	}) {
		validSource(fileId, totalBytes);
		super(totalBytes, new Uint8Array(0), false);
		this.#client = client;
		this.#fileId = fileId;
		this.#totalBytes = totalBytes;
		this.#downloadRange = downloadRange;
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
			this.#fail(new TypeError('Invalid PDF.js range request'));
			return;
		}
		void this.#downloadRange({
			client: this.#client,
			fileId: this.#fileId,
			start: begin,
			endExclusive: end,
			totalBytes: this.#totalBytes
		})
			.then((blob) => blob.arrayBuffer())
			.then((buffer) => {
				const bytes = new Uint8Array(buffer);
				if (this.#aborted || this.#failed) {
					bytes.fill(0);
					return;
				}
				if (bytes.byteLength !== end - begin) {
					bytes.fill(0);
					this.#fail(new Error('Drive PDF range length mismatch'));
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

export class DrivePdfRangeError extends Error {
	constructor() {
		super('Não foi possível ler o PDF grande por faixas no Google Drive.');
		this.name = 'DrivePdfRangeError';
	}
}

async function configurePdfWorker() {
	const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
	GlobalWorkerOptions.workerSrc = workerModule.default;
}

const defaultDependencies: DrivePdfRangeDependencies = {
	downloadRange: downloadBrowserDriveRange,
	configureWorker: configurePdfWorker,
	createLoadingTask: getDocument
};

export async function openDrivePdfRangeDocument({
	client,
	fileId,
	totalBytes,
	dependencies = defaultDependencies
}: {
	client: DriveMediaClientLike;
	fileId: string;
	totalBytes: number;
	dependencies?: DrivePdfRangeDependencies;
}): Promise<DrivePdfRangeDocument> {
	validSource(fileId, totalBytes);
	let loadingTask: LoadingTaskLike | null = null;
	let destroyed = false;
	let rejectRangeFailure: (error: unknown) => void = () => undefined;
	const rangeFailure = new Promise<never>((_resolve, reject) => {
		rejectRangeFailure = reject;
	});
	const transport = new DrivePdfDataRangeTransport({
		client,
		fileId,
		totalBytes,
		downloadRange: dependencies.downloadRange,
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
			rangeChunkSize: DRIVE_PDF_RANGE_CHUNK_BYTES,
			disableRange: false,
			disableStream: true,
			disableAutoFetch: true
		});
		const document = await Promise.race([loadingTask.promise, rangeFailure]);
		return Object.freeze({ document, destroy: destroyLoadingTask });
	} catch {
		await destroyLoadingTask();
		throw new DrivePdfRangeError();
	}
}
