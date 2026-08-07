import {
	PDFDataRangeTransport,
	getDocument,
	type PDFDocumentProxy
} from 'pdfjs-dist';
import { downloadBrowserDriveRange } from '$lib/drive/browser-files';
import type { DriveTokenClientLike } from '$lib/drive/browser-upload';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
export const DRIVE_PDF_RANGE_CHUNK_BYTES = 256 * 1024;

type DownloadRange = typeof downloadBrowserDriveRange;
type PdfDocumentSource = Parameters<typeof getDocument>[0];
type LoadingTaskLike = {
	promise: Promise<PDFDocumentProxy>;
	destroy(): Promise<void>;
};

export interface DrivePdfRangeDependencies {
	downloadRange: DownloadRange;
	createLoadingTask(source: PdfDocumentSource): LoadingTaskLike;
}

function validSource(fileId: string, totalBytes: number) {
	if (
		!DRIVE_ID.test(fileId) ||
		!Number.isSafeInteger(totalBytes) ||
		totalBytes < 1
	) {
		throw new TypeError('Invalid Drive PDF range source');
	}
}

export class DrivePdfDataRangeTransport extends PDFDataRangeTransport {
	readonly #client: DriveTokenClientLike;
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
		client: DriveTokenClientLike;
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

const defaultDependencies: DrivePdfRangeDependencies = {
	downloadRange: downloadBrowserDriveRange,
	createLoadingTask: getDocument
};

export async function openDrivePdfRangeDocument({
	client,
	fileId,
	totalBytes,
	dependencies = defaultDependencies
}: {
	client: DriveTokenClientLike;
	fileId: string;
	totalBytes: number;
	dependencies?: DrivePdfRangeDependencies;
}): Promise<PDFDocumentProxy> {
	validSource(fileId, totalBytes);
	let loadingTask: LoadingTaskLike | null = null;
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
			void loadingTask?.destroy().catch(() => undefined);
		}
	});

	try {
		loadingTask = dependencies.createLoadingTask({
			range: transport,
			rangeChunkSize: DRIVE_PDF_RANGE_CHUNK_BYTES,
			disableRange: false,
			disableStream: true,
			disableAutoFetch: true
		});
		return await Promise.race([loadingTask.promise, rangeFailure]);
	} catch {
		transport.abort();
		await loadingTask?.destroy().catch(() => undefined);
		throw new DrivePdfRangeError();
	}
}
