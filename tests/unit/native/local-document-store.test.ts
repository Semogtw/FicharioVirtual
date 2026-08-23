import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getNativeStatus,
	listNativeDocumentPages,
	listNativeDocumentsPage,
	nativeImportRanges,
	reconcileNativeDocuments,
	readNativeOriginal,
	readNativeDocumentRange,
	resolveNativeDocument,
	searchNativeDocumentPages,
	updateNativeDocumentMetadata
} from '../../../src/lib/native/local-document-store';
import { isNativeRuntime } from '../../../src/lib/platform/native-bridge';

type MutableGlobal = typeof globalThis & {
	__TAURI__?: { core: { invoke: ReturnType<typeof vi.fn> } };
};

const root = globalThis as MutableGlobal;

afterEach(() => {
	delete root.__TAURI__;
	vi.restoreAllMocks();
});

describe('native runtime bridge', () => {
	it('stays inert in the web build', async () => {
		expect(isNativeRuntime()).toBe(false);
		expect(await getNativeStatus()).toBeNull();
		expect(await resolveNativeDocument('doc-1')).toBeNull();
	});

	it('uses the globally injected Tauri invoke bridge without a JS package dependency', async () => {
		const invoke = vi.fn().mockResolvedValue({
			platform: 'linux',
			schemaVersion: 1,
			localDocumentCount: 2,
			pendingSyncCount: 1,
			diskUsageBytes: 123,
			maxDocumentBytes: 1000,
			maxIpcChunkBytes: 512
		});
		root.__TAURI__ = { core: { invoke } };
		expect(isNativeRuntime()).toBe(true);
		expect((await getNativeStatus())?.platform).toBe('linux');
		expect(invoke).toHaveBeenCalledWith('native_status', undefined);
	});

	it('reads native ranges from Tauri raw ArrayBuffer responses', async () => {
		const expected = Uint8Array.from([1, 2, 3, 4]);
		const invoke = vi.fn().mockResolvedValue(expected.buffer.slice(0));
		root.__TAURI__ = { core: { invoke } };

		const bytes = await readNativeDocumentRange('doc-1', 4, 8);

		expect(bytes).toEqual(expected);
		expect(invoke).toHaveBeenCalledWith('read_local_document_range', {
			request: { documentId: 'doc-1', start: 4, endExclusive: 8 }
		});
	});

	it('reads a present native original for the offline viewer before any remote request', async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce({
				documentId: 'doc-1',
				ownerId: '11111111-1111-4111-8111-111111111111',
				originalFilename: 'documento.png',
				mimeType: 'image/png',
				sizeBytes: 4,
				sha256: 'a'.repeat(64),
				localState: 'present',
				remoteState: 'synced',
				remoteDocumentId: 'doc-1',
				driveFileId: null,
				createdAtMs: 1,
				updatedAtMs: 1,
				lastAccessedAtMs: 1
			})
			.mockResolvedValueOnce(Uint8Array.from([1, 2, 3, 4]).buffer);
		root.__TAURI__ = { core: { invoke } };

		const original = await readNativeOriginal('doc-1', 'image/*', 16);

		expect(original).not.toBeNull();
		expect(original?.type).toBe('image/png');
		expect([...new Uint8Array(await original!.arrayBuffer())]).toEqual([1, 2, 3, 4]);
		expect(invoke).toHaveBeenNthCalledWith(1, 'get_local_document', {
			request: { documentId: 'doc-1' }
		});
		expect(invoke).toHaveBeenNthCalledWith(2, 'read_local_document_range', {
			request: { documentId: 'doc-1', start: 0, endExclusive: 4 }
		});
	});

	it('treats native catalog failures as a cache miss so remote fallback can continue', async () => {
		const invoke = vi.fn().mockRejectedValue(new Error('catalog unavailable'));
		root.__TAURI__ = { core: { invoke } };

		await expect(readNativeOriginal('doc-1', 'image/*', 16)).resolves.toBeNull();
		expect(invoke).toHaveBeenCalledWith('get_local_document', {
			request: { documentId: 'doc-1' }
		});
	});

	it('reconciles the complete native catalog with an optional full hash', async () => {
		const invoke = vi.fn().mockResolvedValue({
			inspectedDocuments: 3,
			missingDocuments: 1,
			corruptDocuments: 1,
			unchangedDocuments: 1
		});
		root.__TAURI__ = { core: { invoke } };

		await expect(reconcileNativeDocuments(true)).resolves.toEqual({
			inspectedDocuments: 3,
			missingDocuments: 1,
			corruptDocuments: 1,
			unchangedDocuments: 1
		});
		expect(invoke).toHaveBeenCalledWith('reconcile_native_documents', {
			request: { fullHash: true }
		});
	});

	it('rejects malformed reconciliation summaries from the native runtime', async () => {
		const invoke = vi.fn().mockResolvedValue({
			inspectedDocuments: 3,
			missingDocuments: 1,
			corruptDocuments: '1',
			unchangedDocuments: 1
		});
		root.__TAURI__ = { core: { invoke } };

		await expect(reconcileNativeDocuments()).rejects.toThrow(
			'Invalid native reconciliation summary'
		);
	});

	it('reads a cursor page without imposing a library-wide limit', async () => {
		const invoke = vi.fn().mockResolvedValue({
			documents: [
				{
					documentId: 'doc-page-a',
					ownerId: '11111111-1111-4111-8111-111111111111',
					originalFilename: 'page.pdf',
					mimeType: 'application/pdf',
					sizeBytes: 4,
					sha256: 'a'.repeat(64),
					localState: 'present',
					remoteState: 'pending',
					remoteDocumentId: null,
					driveFileId: null,
					createdAtMs: 1,
					updatedAtMs: 1,
					lastAccessedAtMs: 1
				}
			],
			nextCursor: { lastAccessedAtMs: 1, documentId: 'doc-page-a' }
		});
		root.__TAURI__ = { core: { invoke } };

		await expect(
			listNativeDocumentsPage({
				limit: 2,
				cursor: { lastAccessedAtMs: 9, documentId: 'doc-page-z' }
			})
		).resolves.toMatchObject({
			documents: [{ documentId: 'doc-page-a' }],
			nextCursor: { lastAccessedAtMs: 1, documentId: 'doc-page-a' }
		});
		expect(invoke).toHaveBeenCalledWith('list_native_documents_page', {
			request: {
				limit: 2,
				cursor: { lastAccessedAtMs: 9, documentId: 'doc-page-z' }
			}
		});
	});

	it('round-trips owner-scoped document metadata and page text', async () => {
		const invoke = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce([
				{
					documentId: 'doc-metadata',
					pageNumber: 1,
					nativeText: 'texto nativo',
					ocrRawText: 'texto OCR',
					correctedText: 'texto corrigido',
					extractionSource: 'ocr',
					wordGeometry: [{ text: 'texto', left: 10, top: 20, right: 80, bottom: 50 }],
					warnings: [{ code: 'ocr_review', message: 'Revisar' }],
					wasManuallyReviewed: true,
					status: 'ready',
					updatedAtMs: 10
				}
			]);
		root.__TAURI__ = { core: { invoke } };

		await updateNativeDocumentMetadata({
			documentId: 'doc-metadata',
			ownerId: '11111111-1111-4111-8111-111111111111',
			title: 'Aula local',
			notebookId: null,
			pageCount: 1,
			status: 'ready',
			pages: [
				{
					pageNumber: 1,
					nativeText: 'texto nativo',
					ocrRawText: 'texto OCR',
					correctedText: 'texto corrigido',
					extractionSource: 'ocr',
					wordGeometry: [{ text: 'texto', left: 10, top: 20, right: 80, bottom: 50 }],
					warnings: [{ code: 'ocr_review', message: 'Revisar' }],
					wasManuallyReviewed: true
				}
			]
		});
		await expect(
			listNativeDocumentPages('doc-metadata', '11111111-1111-4111-8111-111111111111')
		).resolves.toMatchObject([{ pageNumber: 1, nativeText: 'texto nativo' }]);
		expect(invoke).toHaveBeenNthCalledWith(1, 'update_native_document_metadata', {
			request: {
				documentId: 'doc-metadata',
				ownerId: '11111111-1111-4111-8111-111111111111',
				title: 'Aula local',
				notebookId: null,
				pageCount: 1,
				status: 'ready',
				pages: [
					{
						pageNumber: 1,
						nativeText: 'texto nativo',
						ocrRawText: 'texto OCR',
						correctedText: 'texto corrigido',
						extractionSource: 'ocr',
						wordGeometry: [{ text: 'texto', left: 10, top: 20, right: 80, bottom: 50 }],
						warnings: [{ code: 'ocr_review', message: 'Revisar' }],
						wasManuallyReviewed: true
					}
				]
			}
		});
		expect(invoke).toHaveBeenNthCalledWith(2, 'list_native_document_pages', {
			request: {
				documentId: 'doc-metadata',
				ownerId: '11111111-1111-4111-8111-111111111111'
			}
		});
	});

	it('queries the native FTS index with bounded owner-scoped pagination', async () => {
		const invoke = vi.fn().mockResolvedValue([
			{
				documentId: 'doc-search',
				documentTitle: 'Aula local',
				notebookId: 'notebook-1',
				pageNumber: 2,
				nativeText: 'Texto indexado',
				rank: 0.25
			}
		]);
		root.__TAURI__ = { core: { invoke } };

		await expect(
			searchNativeDocumentPages({
				ownerId: 'owner-1',
				query: '  texto  ',
				notebookId: 'notebook-1',
				limit: 20,
				offset: 40
			})
		).resolves.toMatchObject([{ documentId: 'doc-search', pageNumber: 2 }]);
		expect(invoke).toHaveBeenCalledWith('search_native_document_pages', {
			request: {
				ownerId: 'owner-1',
				query: 'texto',
				notebookId: 'notebook-1',
				limit: 20,
				offset: 40
			}
		});
	});

	it('rejects native search results and pagination outside the bridge contract', async () => {
		const invoke = vi.fn().mockResolvedValue([
			{
				documentId: 'doc-search',
				documentTitle: 'Aula local',
				notebookId: null,
				pageNumber: 1,
				nativeText: 'Texto indexado',
				rank: -1
			}
		]);
		root.__TAURI__ = { core: { invoke } };

		await expect(
			searchNativeDocumentPages({ ownerId: 'owner-1', query: 'texto', limit: 101 })
		).rejects.toThrow('Invalid native search limit');
		await expect(
			searchNativeDocumentPages({ ownerId: 'owner-1', query: 'texto', offset: -1 })
		).rejects.toThrow('Invalid native search offset');
		await expect(searchNativeDocumentPages({ ownerId: 'owner-1', query: 'texto' })).rejects.toThrow(
			'Invalid native search result'
		);
		expect(invoke).toHaveBeenCalledTimes(1);
	});
});

describe('native import ranges', () => {
	it('covers the input exactly without overlapping chunks', () => {
		expect(nativeImportRanges(10, 4)).toEqual([
			{ start: 0, endExclusive: 4 },
			{ start: 4, endExclusive: 8 },
			{ start: 8, endExclusive: 10 }
		]);
	});

	it('rejects invalid and oversized IPC chunks', () => {
		expect(() => nativeImportRanges(0, 4)).toThrow();
		expect(() => nativeImportRanges(10, 0)).toThrow();
		expect(() => nativeImportRanges(10, 512 * 1024 + 1)).toThrow();
	});
});
