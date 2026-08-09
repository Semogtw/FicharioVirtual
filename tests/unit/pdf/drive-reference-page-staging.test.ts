import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_DRIVE_PDF_DESCRIPTOR_BATCH_SIZE,
	stageDrivePdfReferencePageDescriptors
} from '../../../src/lib/pdf/drive-reference-page-staging';
import type { PdfImportPagePlan } from '../../../src/lib/pdf/import-plan';

const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function pages(count: number): readonly PdfImportPagePlan[] {
	return Array.from({ length: count }, (_, index) => {
		const pageNumber = index + 1;
		const suffix = String(pageNumber).padStart(12, '0');
		const id = `11111111-1111-4111-8111-${suffix}`;
		if (pageNumber % 3 === 0) {
			return Object.freeze({
				id,
				pageNumber,
				nativeText: null,
				needsOcr: true,
				temporaryImagePath: `user/${documentId}/pages/${pageNumber}.webp`,
				jobId: `22222222-2222-4222-8222-${suffix}`
			});
		}
		return Object.freeze({
			id,
			pageNumber,
			nativeText: `Texto ${pageNumber}`,
			needsOcr: false,
			temporaryImagePath: null,
			jobId: null
		});
	});
}

describe('Drive PDF page descriptor staging', () => {
	it('splits a large logical page plan into bounded ordered RPC batches', async () => {
		const stageBatch = vi.fn().mockResolvedValue(undefined);
		const source = pages(DEFAULT_DRIVE_PDF_DESCRIPTOR_BATCH_SIZE * 2 + 7);
		const progress: Array<[number, number, number]> = [];

		await stageDrivePdfReferencePageDescriptors({
			documentId,
			pages: source,
			stageBatch,
			onBatch: (current, total, stagedPages) => progress.push([current, total, stagedPages])
		});

		expect(stageBatch).toHaveBeenCalledTimes(3);
		expect(stageBatch.mock.calls.map((call) => call[0].descriptors.length)).toEqual([
			DEFAULT_DRIVE_PDF_DESCRIPTOR_BATCH_SIZE,
			DEFAULT_DRIVE_PDF_DESCRIPTOR_BATCH_SIZE,
			7
		]);
		expect(stageBatch.mock.calls[0]?.[0]).toMatchObject({ documentId });
		expect(stageBatch.mock.calls[2]?.[0].descriptors[6].pageNumber).toBe(source.length);
		expect(progress).toEqual([
			[1, 3, DEFAULT_DRIVE_PDF_DESCRIPTOR_BATCH_SIZE],
			[2, 3, DEFAULT_DRIVE_PDF_DESCRIPTOR_BATCH_SIZE * 2],
			[3, 3, source.length]
		]);
	});

	it('supports a custom smaller transport batch without changing the logical document', async () => {
		const stageBatch = vi.fn().mockResolvedValue(undefined);
		await stageDrivePdfReferencePageDescriptors({
			documentId,
			pages: pages(11),
			batchSize: 4,
			stageBatch
		});
		expect(stageBatch.mock.calls.map((call) => call[0].descriptors.length)).toEqual([4, 4, 3]);
	});

	it('rejects non-contiguous page plans before issuing any RPC', async () => {
		const stageBatch = vi.fn();
		const broken = pages(3).map((page, index) => (index === 1 ? { ...page, pageNumber: 9 } : page));
		await expect(
			stageDrivePdfReferencePageDescriptors({ documentId, pages: broken, stageBatch })
		).rejects.toThrow('Invalid Drive PDF page descriptor plan');
		expect(stageBatch).not.toHaveBeenCalled();
	});

	it('rejects duplicate page and job identifiers before issuing any RPC', async () => {
		const stageBatch = vi.fn();
		const source = pages(3).map((page) => ({ ...page }));
		source[1]!.id = source[0]!.id;
		await expect(
			stageDrivePdfReferencePageDescriptors({ documentId, pages: source, stageBatch })
		).rejects.toThrow('Invalid Drive PDF page descriptor plan');
		expect(stageBatch).not.toHaveBeenCalled();
	});

	it('stops at the first failed batch so a retry can resume idempotently on the server', async () => {
		const stageBatch = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('network unavailable'));
		await expect(
			stageDrivePdfReferencePageDescriptors({
				documentId,
				pages: pages(DEFAULT_DRIVE_PDF_DESCRIPTOR_BATCH_SIZE + 1),
				stageBatch
			})
		).rejects.toThrow('network unavailable');
		expect(stageBatch).toHaveBeenCalledTimes(2);
	});

	it('treats observer failures as UI-only and keeps staging', async () => {
		const stageBatch = vi.fn().mockResolvedValue(undefined);
		await expect(
			stageDrivePdfReferencePageDescriptors({
				documentId,
				pages: pages(3),
				stageBatch,
				onBatch: () => {
					throw new Error('observer failed');
				}
			})
		).resolves.toBeUndefined();
		expect(stageBatch).toHaveBeenCalledOnce();
	});
});
