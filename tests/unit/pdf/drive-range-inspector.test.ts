import { describe, expect, it, vi } from 'vitest';
import { inspectDrivePdfDocument } from '../../../src/lib/pdf/drive-range-inspector';

function page(items: unknown[]) {
	return {
		getTextContent: vi.fn().mockResolvedValue({ items }),
		cleanup: vi.fn()
	};
}

describe('inspectDrivePdfDocument', () => {
	it('extracts native text sequentially and marks only empty pages for OCR', async () => {
		const pages = [
			page([{ str: 'Primeira' }, { str: 'página', hasEOL: true }, { str: 'Texto final' }]),
			page([]),
			page([{ str: 'Terceira página' }])
		];
		const document = {
			numPages: pages.length,
			getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1])
		};

		await expect(inspectDrivePdfDocument(document as never)).resolves.toEqual({
			pageCount: 3,
			nativePages: [
				{ pageNumber: 1, text: 'Primeira página\nTexto final' },
				{ pageNumber: 3, text: 'Terceira página' }
			],
			pagesNeedingOcr: [2],
			ocrReasonsByPage: [{ pageNumber: 2, reasons: ['no_extractable_text'] }]
		});
		expect(document.getPage.mock.calls.map(([pageNumber]) => pageNumber)).toEqual([1, 2, 3]);
		for (const current of pages) expect(current.cleanup).toHaveBeenCalledOnce();
	});

	it('stops before requesting more pages when cancelled', async () => {
		const first = page([{ str: 'Texto' }]);
		const controller = new AbortController();
		first.getTextContent.mockImplementation(async () => {
			controller.abort();
			return { items: [{ str: 'Texto' }] };
		});
		const document = {
			numPages: 2,
			getPage: vi.fn(async () => first)
		};

		await expect(
			inspectDrivePdfDocument(document as never, { signal: controller.signal })
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(document.getPage).toHaveBeenCalledTimes(1);
		expect(first.cleanup).toHaveBeenCalledOnce();
	});

	it('rejects documents beyond the logical 10,000-page contract before reading pages', async () => {
		const document = { numPages: 10_001, getPage: vi.fn() };
		await expect(inspectDrivePdfDocument(document as never)).rejects.toThrow(
			'O PDF remoto excede o limite lógico de páginas suportado.'
		);
		expect(document.getPage).not.toHaveBeenCalled();
	});
});
