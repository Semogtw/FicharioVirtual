import { describe, expect, it, vi } from 'vitest';
import { inspectDrivePdfDocument } from '../../../src/lib/pdf/drive-range-inspector';

function page(text: string) {
	return {
		getTextContent: vi.fn().mockResolvedValue({ items: text ? [{ str: text }] : [] }),
		cleanup: vi.fn()
	};
}

describe('Drive PDF range inspection progress', () => {
	it('reports each cleaned page in order without letting observer failures break inspection', async () => {
		const pages = [page('Um'), page(''), page('Três')];
		const document = {
			numPages: pages.length,
			getPage: vi.fn(async (pageNumber: number) => pages[pageNumber - 1])
		};
		const onPage = vi
			.fn()
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => {
				throw new Error('UI observer failed');
			})
			.mockImplementationOnce(() => undefined);

		await expect(inspectDrivePdfDocument(document as never, { onPage })).resolves.toMatchObject({
			pageCount: 3,
			pagesNeedingOcr: [2]
		});

		expect(onPage.mock.calls).toEqual([
			[1, 3],
			[2, 3],
			[3, 3]
		]);
		for (const current of pages) expect(current.cleanup).toHaveBeenCalledOnce();
	});
});
