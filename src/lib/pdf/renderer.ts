import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { safelyWipeBytes } from './safe-wipe';

export type RenderPdfPageOptions = {
	maxDimension?: number;
	quality?: number;
	signal?: AbortSignal;
};

export class PdfRenderError extends Error {
	readonly code: 'invalid_page' | 'encrypted_pdf' | 'render_failed';

	constructor(code: PdfRenderError['code']) {
		const messages = {
			invalid_page: 'A página solicitada não existe neste PDF.',
			encrypted_pdf: 'Este PDF exige senha e ainda não pode ser renderizado.',
			render_failed: 'Não foi possível preparar esta página para leitura.'
		} as const;
		super(messages[code]);
		this.name = 'PdfRenderError';
		this.code = code;
	}
}

function abortError() {
	return new DOMException('PDF rendering was cancelled', 'AbortError');
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
	return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encode(canvas: HTMLCanvasElement, quality: number) {
	const webp = await toBlob(canvas, 'image/webp', quality);
	if (webp && webp.size > 0 && webp.type === 'image/webp') return webp;
	const jpeg = await toBlob(canvas, 'image/jpeg', quality);
	if (!jpeg || jpeg.size < 1) throw new PdfRenderError('render_failed');
	return jpeg;
}

function safely(operation: (() => unknown) | undefined) {
	try {
		operation?.();
	} catch {
		// Cleanup is best-effort and must not replace the primary result.
	}
}

function renderOptions(options: RenderPdfPageOptions) {
	const maxDimension = options.maxDimension ?? 2400;
	const quality = options.quality ?? 0.88;
	if (!Number.isInteger(maxDimension) || maxDimension < 2048 || maxDimension > 2560) {
		throw new TypeError('PDF render dimension must be between 2048 and 2560');
	}
	if (!Number.isFinite(quality) || quality < 0.6 || quality > 0.95) {
		throw new TypeError('Invalid PDF render quality');
	}
	return { maxDimension, quality };
}

export async function renderPdfDocumentPage(
	pdfDocument: PDFDocumentProxy,
	pageNumber: number,
	options: RenderPdfPageOptions = {}
): Promise<Blob> {
	if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDocument.numPages) {
		throw new PdfRenderError('invalid_page');
	}
	const { maxDimension, quality } = renderOptions(options);
	if (options.signal?.aborted) throw abortError();

	let pdfPage: PDFPageProxy | null = null;
	let canvas: HTMLCanvasElement | null = null;
	let renderTask: RenderTask | null = null;
	const cancel = () => safely(() => renderTask?.cancel());
	options.signal?.addEventListener('abort', cancel, { once: true });

	try {
		try {
			pdfPage = await pdfDocument.getPage(pageNumber);
		} catch {
			if (options.signal?.aborted) throw abortError();
			throw new PdfRenderError('render_failed');
		}
		if (options.signal?.aborted) throw abortError();
		const baseViewport = pdfPage.getViewport({ scale: 1 });
		const scale = maxDimension / Math.max(baseViewport.width, baseViewport.height);
		const viewport = pdfPage.getViewport({ scale });
		canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(viewport.width));
		canvas.height = Math.max(1, Math.round(viewport.height));
		const context = canvas.getContext('2d', { alpha: false });
		if (!context) throw new PdfRenderError('render_failed');

		renderTask = pdfPage.render({
			canvas,
			canvasContext: context,
			viewport,
			background: '#ffffff'
		});
		try {
			await renderTask.promise;
		} catch {
			if (options.signal?.aborted) throw abortError();
			throw new PdfRenderError('render_failed');
		}
		if (options.signal?.aborted) throw abortError();
		const encoded = await encode(canvas, quality);
		if (options.signal?.aborted) throw abortError();
		return encoded;
	} finally {
		options.signal?.removeEventListener('abort', cancel);
		safely(() => renderTask?.cancel());
		safely(() => pdfPage?.cleanup());
		if (canvas) {
			canvas.width = 0;
			canvas.height = 0;
		}
	}
}

export async function renderPdfPage(
	file: File,
	pageNumber: number,
	options: RenderPdfPageOptions = {}
): Promise<Blob> {
	if (file.type !== 'application/pdf' || file.size < 1) throw new PdfRenderError('render_failed');
	if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new PdfRenderError('invalid_page');
	renderOptions(options);
	if (options.signal?.aborted) throw abortError();

	const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
		import('pdfjs-dist'),
		import('pdfjs-dist/build/pdf.worker.min.mjs?url')
	]);
	if (options.signal?.aborted) throw abortError();
	GlobalWorkerOptions.workerSrc = workerModule.default;

	const bytes = new Uint8Array(await file.arrayBuffer());
	if (options.signal?.aborted) {
		safelyWipeBytes(bytes);
		throw abortError();
	}
	const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
	let pdfDocument: PDFDocumentProxy | null = null;
	let destroyPromise: Promise<void> | null = null;
	const destroyLoadingTask = () => {
		destroyPromise ??= Promise.resolve(loadingTask.destroy()).catch(() => undefined);
		return destroyPromise;
	};
	const cancel = () => void destroyLoadingTask();
	options.signal?.addEventListener('abort', cancel, { once: true });

	try {
		try {
			pdfDocument = await loadingTask.promise;
		} catch (error) {
			if (options.signal?.aborted) throw abortError();
			const detail = error instanceof Error ? error.message : String(error);
			throw new PdfRenderError(/password/i.test(detail) ? 'encrypted_pdf' : 'render_failed');
		}
		if (options.signal?.aborted) throw abortError();
		return await renderPdfDocumentPage(pdfDocument, pageNumber, options);
	} finally {
		options.signal?.removeEventListener('abort', cancel);
		safely(() => pdfDocument?.cleanup());
		await destroyLoadingTask();
		safelyWipeBytes(bytes);
	}
}
