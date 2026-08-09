import { describe, expect, it, vi } from 'vitest';
import {
	MAX_DRIVE_PDF_DESCRIPTOR_BATCH_BYTES,
	stageDrivePdfReferencePageDescriptors
} from '../../../src/lib/pdf/drive-reference-page-staging';
import type { PdfImportPagePlan } from '../../../src/lib/pdf/import-plan';

const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function textHeavyPages(count: number): readonly PdfImportPagePlan[] {
	return Array.from({ length: count }, (_, index) => {
		const pageNumber = index + 1;
		const suffix = String(pageNumber).padStart(12, '0');
		return Object.freeze({
			id: `11111111-1111-4111-8111-${suffix}`,
			pageNumber,
			nativeText: `Página ${pageNumber} ${'x'.repeat(119_980)}`,
			needsOcr: false,
			temporaryImagePath: null,
			jobId: null
		});
	});
}

describe('Drive PDF descriptor byte-bounded staging', () => {
	it('splits text-heavy descriptors before the server JSONB payload ceiling', async () => {
		const stageBatch = vi.fn().mockResolvedValue(undefined);
		const source = textHeavyPages(40);

		await stageDrivePdfReferencePageDescriptors({
			documentId,
			pages: source,
			stageBatch
		});

		expect(stageBatch.mock.calls.length).toBeGreaterThan(1);
		expect(
			stageBatch.mock.calls.reduce(
				(total, call) => total + (call[0].descriptors as readonly unknown[]).length,
				0
			)
		).toBe(source.length);

		const encoder = new TextEncoder();
		for (const [input] of stageBatch.mock.calls) {
			const bytes = encoder.encode(JSON.stringify(input.descriptors)).byteLength;
			expect(bytes).toBeLessThanOrEqual(MAX_DRIVE_PDF_DESCRIPTOR_BATCH_BYTES);
		}
	});
});
