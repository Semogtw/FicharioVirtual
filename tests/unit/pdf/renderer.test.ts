import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdfRuntime = vi.hoisted(() => ({
	getDocument: vi.fn(),
	workerOptions: { workerSrc: '' }
}));

vi.mock('pdfjs-dist', () => ({
	getDocument: pdfRuntime.getDocument,
	GlobalWorkerOptions: pdfRuntime.workerOptions
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
	default: '/pdf.worker.js'
}));

import { renderPdfDocumentPage, renderPdfPage } from '../../../src/lib/pdf/renderer';

type BlobCallback = (blob: Blob | null) => void;

type CanvasFixture = {
	canvas: HTMLCanvasElement;
	callbacks: BlobCallback[];
};

function canvasFixture(): CanvasFixture {
	const callbacks: BlobCallback[] = [];
	const canvas = {
		width: 0,
		height: 0,
		getContext: vi.fn(() => ({})),
		toBlob(callback: BlobCallback) {
			callbacks.push(callback);
		}
	} as unknown as HTMLCanvasElement;
	return { canvas, callbacks };
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function pdfFile() {
	return new File(['pdf'], 'notes.pdf', { type: 'application/pdf' });
}

function successfulPdf(options: {
	canvas: CanvasFixture;
	pageCleanup?: () => void;
	documentCleanup?: () => void;
	destroy?: () => Promise<void>;
}) {
	const render = deferred<void>();
	const renderTask = { promise: render.promise, cancel: vi.fn() };
	const page = {
		getViewport: vi.fn(({ scale }: { scale: number }) => ({
			width: 100 * scale,
			height: 200 * scale
		})),
		render: vi.fn(() => renderTask),
		cleanup: vi.fn(options.pageCleanup)
	};
	const document = {
		numPages: 1,
		getPage: vi.fn(async () => page),
		cleanup: vi.fn(options.documentCleanup)
	};
	const loadingTask = {
		promise: Promise.resolve(document),
		destroy: vi.fn(options.destroy ?? (async () => undefined))
	};
	pdfRuntime.getDocument.mockReturnValue(loadingTask);
	return { render, renderTask, page, document, loadingTask };
}

let originalDocument: Document | undefined;

beforeEach(() => {
	pdfRuntime.getDocument.mockReset();
	pdfRuntime.workerOptions.workerSrc = '';
	originalDocument = globalThis.document;
});

afterEach(() => {
	if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
	else globalThis.document = originalDocument;
});

describe('renderPdfDocumentPage', () => {
	it('renders from an already-open document without loading or destroying the document', async () => {
		const fixture = canvasFixture();
		globalThis.document = {
			createElement: vi.fn(() => fixture.canvas)
		} as unknown as Document;
		const pdf = successfulPdf({ canvas: fixture });

		const pending = renderPdfDocumentPage(pdf.document as never, 1);
		await vi.waitFor(() => expect(pdf.page.render).toHaveBeenCalledOnce());
		pdf.render.resolve();
		await vi.waitFor(() => expect(fixture.callbacks).toHaveLength(1));
		const encoded = new Blob(['page'], { type: 'image/webp' });
		fixture.callbacks[0]?.(encoded);

		await expect(pending).resolves.toBe(encoded);
		expect(pdfRuntime.getDocument).not.toHaveBeenCalled();
		expect(pdf.loadingTask.destroy).not.toHaveBeenCalled();
		expect(pdf.document.cleanup).not.toHaveBeenCalled();
		expect(pdf.page.cleanup).toHaveBeenCalledOnce();
	});
});

describe('renderPdfPage cancellation and cleanup', () => {
	it('disables PDF scripting while loading untrusted local files', async () => {
		const loading = deferred<never>();
		const loadingTask = {
			promise: loading.promise,
			destroy: vi.fn(async () => {
				loading.reject(new Error('loading destroyed'));
			})
		};
		pdfRuntime.getDocument.mockReturnValue(loadingTask);
		const controller = new AbortController();

		const pending = renderPdfPage(pdfFile(), 1, { signal: controller.signal });
		await vi.waitFor(() => expect(pdfRuntime.getDocument).toHaveBeenCalledOnce());
		expect(pdfRuntime.getDocument).toHaveBeenCalledWith(
			expect.objectContaining({ enableScripting: false, useSystemFonts: true })
		);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('reports AbortError when cancellation interrupts PDF loading', async () => {
		const loading = deferred<never>();
		const loadingTask = {
			promise: loading.promise,
			destroy: vi.fn(async () => {
				loading.reject(new Error('loading destroyed'));
			})
		};
		pdfRuntime.getDocument.mockReturnValue(loadingTask);
		const controller = new AbortController();

		const pending = renderPdfPage(pdfFile(), 1, { signal: controller.signal });
		await vi.waitFor(() => expect(pdfRuntime.getDocument).toHaveBeenCalledOnce());
		controller.abort();

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(loadingTask.destroy).toHaveBeenCalledTimes(1);
	});

	it('does not return an encoded page after cancellation during canvas encoding', async () => {
		const fixture = canvasFixture();
		globalThis.document = {
			createElement: vi.fn(() => fixture.canvas)
		} as unknown as Document;
		const pdf = successfulPdf({ canvas: fixture });
		const controller = new AbortController();

		const pending = renderPdfPage(pdfFile(), 1, { signal: controller.signal });
		await vi.waitFor(() => expect(pdf.page.render).toHaveBeenCalledOnce());
		pdf.render.resolve();
		await vi.waitFor(() => expect(fixture.callbacks).toHaveLength(1));
		controller.abort();
		fixture.callbacks[0]?.(new Blob(['page'], { type: 'image/webp' }));

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(pdf.renderTask.cancel).toHaveBeenCalled();
	});

	it('does not let cleanup failures replace a successfully encoded page', async () => {
		const fixture = canvasFixture();
		globalThis.document = {
			createElement: vi.fn(() => fixture.canvas)
		} as unknown as Document;
		const pdf = successfulPdf({
			canvas: fixture,
			pageCleanup: () => {
				throw new Error('page cleanup failed');
			},
			documentCleanup: () => {
				throw new Error('document cleanup failed');
			},
			destroy: async () => {
				throw new Error('destroy failed');
			}
		});

		const pending = renderPdfPage(pdfFile(), 1);
		await vi.waitFor(() => expect(pdf.page.render).toHaveBeenCalledOnce());
		pdf.render.resolve();
		await vi.waitFor(() => expect(fixture.callbacks).toHaveLength(1));
		const encoded = new Blob(['page'], { type: 'image/webp' });
		fixture.callbacks[0]?.(encoded);

		await expect(pending).resolves.toBe(encoded);
	});
});
