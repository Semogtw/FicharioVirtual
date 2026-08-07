import { describe, expect, it, vi } from 'vitest';
import {
	expectedDrivePdfReferencePublication,
	isDrivePdfReferenceStillFinalizable,
	recoverDrivePdfReferencePublication
} from '../../../src/lib/pdf/drive-reference-publication-recovery';
import type { PdfImportPagePlan } from '../../../src/lib/pdf/import-plan';

const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const pages: readonly PdfImportPagePlan[] = Object.freeze([
	Object.freeze({
		id: '11111111-1111-4111-8111-111111111111',
		pageNumber: 1,
		nativeText: 'Texto nativo',
		needsOcr: false,
		temporaryImagePath: null,
		jobId: null
	}),
	Object.freeze({
		id: '22222222-2222-4222-8222-222222222222',
		pageNumber: 2,
		nativeText: null,
		needsOcr: true,
		temporaryImagePath: 'user/document/pages/2.webp',
		jobId: '33333333-3333-4333-8333-333333333333'
	}),
	Object.freeze({
		id: '44444444-4444-4444-8444-444444444444',
		pageNumber: 3,
		nativeText: '',
		needsOcr: false,
		temporaryImagePath: null,
		jobId: null
	})
]);

type QueryReply = { data: unknown; error: unknown };

function client(replies: Record<string, QueryReply>) {
	return {
		from: vi.fn((table: string) => ({
			select: vi.fn(() => ({
				eq: vi.fn(() => ({
					maybeSingle: vi.fn().mockResolvedValue(replies[table] ?? { data: null, error: null })
				}))
			}))
		}))
	} as never;
}

describe('Drive PDF reference publication recovery', () => {
	it('derives the exact finalizer publication expected from the immutable page plan', () => {
		expect(expectedDrivePdfReferencePublication(documentId, pages)).toEqual({
			documentId,
			pageCount: 3,
			ocrPageCount: 1,
			reviewPageCount: 1,
			status: 'partially_ready'
		});
	});

	it('recovers a committed publication only when id, page count, and status all match', async () => {
		const matching = client({
			documents: {
				data: { id: documentId, page_count: 3, status: 'partially_ready' },
				error: null
			}
		});

		await expect(
			recoverDrivePdfReferencePublication({ client: matching, documentId, pages })
		).resolves.toEqual({
			documentId,
			pageCount: 3,
			ocrPageCount: 1,
			reviewPageCount: 1,
			status: 'partially_ready'
		});

		for (const data of [
			{ id: documentId, page_count: 2, status: 'partially_ready' },
			{ id: documentId, page_count: 3, status: 'processing' },
			{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', page_count: 3, status: 'partially_ready' }
		]) {
			await expect(
				recoverDrivePdfReferencePublication({
					client: client({ documents: { data, error: null } }),
					documentId,
					pages
				})
			).resolves.toBeNull();
		}
	});

	it('fails closed when publication recovery cannot establish the database state', async () => {
		await expect(
			recoverDrivePdfReferencePublication({
				client: client({ documents: { data: null, error: new Error('network unavailable') } }),
				documentId,
				pages
			})
		).rejects.toThrow('network unavailable');
	});

	it('allows derivative cleanup only while the durable reference is still finalizable', async () => {
		for (const status of ['pending_inspection', 'inspecting', 'ready_to_finalize']) {
			await expect(
				isDrivePdfReferenceStillFinalizable({
					client: client({
						drive_pdf_reference_imports: {
							data: { document_id: documentId, status },
							error: null
						}
					}),
					documentId
				})
			).resolves.toBe(true);
		}

		await expect(
			isDrivePdfReferenceStillFinalizable({
				client: client({
					drive_pdf_reference_imports: {
						data: { document_id: documentId, status: 'failed' },
						error: null
					}
				}),
				documentId
			})
		).resolves.toBe(false);

		await expect(
			isDrivePdfReferenceStillFinalizable({ client: client({}), documentId })
		).resolves.toBe(false);
	});

	it('does not authorize cleanup when the staging-state lookup fails', async () => {
		await expect(
			isDrivePdfReferenceStillFinalizable({
				client: client({
					drive_pdf_reference_imports: { data: null, error: new Error('state unknown') }
				}),
				documentId
			})
		).rejects.toThrow('state unknown');
	});
});
