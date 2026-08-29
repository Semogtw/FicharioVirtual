import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	loadDocumentDetailWithGateway,
	loadDocumentPreviewWithGateway,
	loadDocumentPageWithGateway,
	mapNativeDocumentDetail,
	type DocumentDetailGateway,
	type DocumentDetailRecord,
	type DocumentPageSummaryRecord
} from '../../../src/lib/services/document-detail';
import type { PageRecord } from '../../../src/lib/domain/page';
import { sessionState } from '../../../src/lib/stores/session.svelte';

const documentId = '11111111-1111-4111-8111-111111111111';
const pageId = '22222222-2222-4222-8222-222222222222';
const pageDriveFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const ownerId = '33333333-3333-4333-8333-333333333333';

type MutableGlobal = typeof globalThis & {
	__TAURI__?: { core: { invoke: ReturnType<typeof vi.fn> } };
};

const root = globalThis as MutableGlobal;

afterEach(() => {
	delete root.__TAURI__;
	sessionState.user = null;
	sessionState.authorized = false;
});

function pageRecord(overrides: Partial<PageRecord> = {}): PageRecord {
	return {
		id: pageId,
		page_number: 1,
		native_text: 'Texto nativo',
		ocr_raw_text: null,
		corrected_text: null,
		extraction_source: 'native_pdf',
		source_drive_file_id: null,
		warnings: [],
		status: 'ready',
		was_manually_reviewed: false,
		updated_at: '2026-08-02T04:00:00.000Z',
		...overrides
	};
}

function pageSummary(
	overrides: Partial<DocumentPageSummaryRecord> = {}
): DocumentPageSummaryRecord {
	return {
		id: pageId,
		page_number: 1,
		source_drive_file_id: null,
		status: 'ready',
		updated_at: '2026-08-02T04:00:00.000Z',
		...overrides
	};
}

function gateway(documentOverrides: Partial<DocumentDetailRecord> = {}) {
	let fullPageLoads = 0;
	const value: DocumentDetailGateway = {
		async loadDocument() {
			return {
				id: documentId,
				title: 'Apostila',
				kind: 'pdf',
				status: 'ready',
				page_count: 1,
				notebook_id: null,
				original_filename: 'apostila.pdf',
				storage_path: 'user/document/original.pdf',
				created_at: '2026-08-02T03:00:00.000Z',
				updated_at: '2026-08-02T04:00:00.000Z',
				...documentOverrides
			};
		},
		async listPageSummaries() {
			return [pageSummary()];
		},
		async loadPage() {
			fullPageLoads += 1;
			return pageRecord();
		},
		async createSignedUrl(path) {
			return `https://private.test/${path}?signed=1`;
		}
	};
	return {
		value,
		get fullPageLoads() {
			return fullPageLoads;
		}
	};
}

describe('loadDocumentDetailWithGateway', () => {
	it('returns a lightweight page index and does not fetch OCR text for every page', async () => {
		const fixture = gateway();
		const detail = await loadDocumentDetailWithGateway(documentId, fixture.value);

		expect(detail.originalUrl).toContain('signed=1');
		expect(detail.originalReference).toEqual({
			provider: 'supabase',
			url: detail.originalUrl,
			driveFileId: null
		});
		expect(detail.pages[0]).toEqual({
			id: pageId,
			pageNumber: 1,
			sourceDriveFileId: null,
			status: 'ready',
			updatedAt: '2026-08-02T04:00:00.000Z'
		});
		expect(fixture.fullPageLoads).toBe(0);
		expect(detail).not.toHaveProperty('storagePath');
	});

	it('loads only the selected page for a search preview', async () => {
		const fixture = gateway();
		fixture.value.listPageSummaries = async () => {
			throw new Error('search preview must not enumerate every page');
		};

		const preview = await loadDocumentPreviewWithGateway(documentId, 1, fixture.value);

		expect(preview.page.text).toBe('Texto nativo');
		expect(preview.detail.pages).toEqual([
			{
				id: pageId,
				pageNumber: 1,
				sourceDriveFileId: null,
				status: 'ready',
				updatedAt: '2026-08-02T04:00:00.000Z'
			}
		]);
		expect(fixture.fullPageLoads).toBe(1);
	});

	it('loads the selected page separately when its text is actually needed', async () => {
		const fixture = gateway();
		const page = await loadDocumentPageWithGateway(documentId, 1, fixture.value);

		expect(page.text).toBe('Texto nativo');
		expect(page.sourceDriveFileId).toBeNull();
		expect(fixture.fullPageLoads).toBe(1);
	});

	it('hydrates the native page cache with full remote analysis metadata', async () => {
		const invoke = vi.fn().mockImplementation(async (command: string) => {
			if (command === 'get_local_document') {
				return {
					documentId,
					ownerId,
					originalFilename: 'apostila.pdf',
					mimeType: 'application/pdf',
					sizeBytes: 128,
					sha256: 'a'.repeat(64),
					localState: 'present',
					remoteState: 'synced',
					remoteDocumentId: documentId,
					driveFileId: null,
					createdAtMs: Date.parse('2026-08-02T03:00:00.000Z'),
					updatedAtMs: Date.parse('2026-08-02T04:00:00.000Z'),
					lastAccessedAtMs: Date.parse('2026-08-02T04:00:00.000Z'),
					title: 'Apostila',
					notebookId: null,
					pageCount: 1,
					status: 'ready'
				};
			}
			return undefined;
		});
		root.__TAURI__ = { core: { invoke } };
		sessionState.user = { id: ownerId } as never;
		sessionState.authorized = true;
		const fixture = gateway();
		fixture.value.loadPage = async () =>
			pageRecord({
				native_text: 'Texto nativo',
				ocr_raw_text: 'Texto OCR',
				corrected_text: 'Texto corrigido',
				extraction_source: 'ocr',
				ocr_word_geometry: [['Texto', 10, 20, 80, 50]],
				warnings: [{ code: 'ocr_review', message: 'Revisar' }],
				was_manually_reviewed: true
			});

		const page = await loadDocumentPageWithGateway(documentId, 1, fixture.value);

		expect(page.text).toBe('Texto corrigido');
		expect(page.wordGeometry).toEqual([
			{ text: 'Texto', left: 10, top: 20, right: 80, bottom: 50 }
		]);
		expect(page.warnings).toEqual([{ code: 'ocr_review', message: 'Revisar' }]);
		expect(page.wasManuallyReviewed).toBe(true);
		await vi.waitFor(() =>
			expect(invoke).toHaveBeenCalledWith('update_native_document_page_metadata', {
				request: {
					documentId,
					ownerId,
					status: 'ready',
					page: {
						pageNumber: 1,
						nativeText: 'Texto nativo',
						ocrRawText: 'Texto OCR',
						correctedText: 'Texto corrigido',
						extractionSource: 'ocr',
						wordGeometry: [{ text: 'Texto', left: 10, top: 20, right: 80, bottom: 50 }],
						warnings: [{ code: 'ocr_review', message: 'Revisar' }],
						wasManuallyReviewed: true
					}
				}
			})
		);
	});

	it('maps a Drive original and page source for an image without loading OCR text', async () => {
		const fixture = gateway({
			kind: 'image',
			storage_path: null,
			drive_file_id: pageDriveFileId,
			physical_state: 'available',
			original_filename: 'pagina-1.jpg'
		});
		fixture.value.listPageSummaries = async () => [
			pageSummary({ source_drive_file_id: pageDriveFileId })
		];
		const detail = await loadDocumentDetailWithGateway(documentId, fixture.value);

		expect(detail.pages[0]).toMatchObject({
			pageNumber: 1,
			sourceDriveFileId: pageDriveFileId
		});
		expect(detail.originalReference).toEqual({
			provider: 'google_drive',
			url: `https://drive.google.com/file/d/${pageDriveFileId}/view`,
			driveFileId: pageDriveFileId
		});
		expect(fixture.fullPageLoads).toBe(0);
	});

	it('resolves a Drive reference when no Storage copy exists without persisting a token', async () => {
		const fixture = gateway({
			storage_path: null,
			drive_file_id: pageDriveFileId,
			physical_state: 'available'
		});
		const detail = await loadDocumentDetailWithGateway(documentId, fixture.value);

		expect(detail.originalUrl).toBe(`https://drive.google.com/file/d/${pageDriveFileId}/view`);
		expect(detail.originalReference).toEqual({
			provider: 'google_drive',
			url: detail.originalUrl,
			driveFileId: pageDriveFileId
		});
		expect(detail.originalUrl).not.toContain('token');
	});

	it('keeps an absent Drive original visible without trying to sign a null Storage path', async () => {
		const fixture = gateway({
			storage_path: null,
			drive_file_id: pageDriveFileId,
			physical_state: 'missing'
		});
		const detail = await loadDocumentDetailWithGateway(documentId, fixture.value);

		expect(detail.originalUrl).toBeNull();
		expect(detail.physicalState).toBe('missing');
		expect(detail.originalReference).toEqual({
			provider: 'missing',
			url: null,
			driveFileId: pageDriveFileId
		});
	});
});

describe('native document detail mapping', () => {
	it('creates an offline detail shell and deterministic page index', () => {
		expect(
			mapNativeDocumentDetail(
				{
					documentId,
					ownerId: '33333333-3333-4333-8333-333333333333',
					originalFilename: 'Apostila.pdf',
					mimeType: 'application/pdf',
					sizeBytes: 128,
					sha256: 'a'.repeat(64),
					localState: 'present',
					remoteState: 'synced',
					remoteDocumentId: documentId,
					driveFileId: pageDriveFileId,
					createdAtMs: Date.parse('2026-08-02T01:00:00.000Z'),
					updatedAtMs: Date.parse('2026-08-02T02:00:00.000Z'),
					lastAccessedAtMs: Date.parse('2026-08-02T03:00:00.000Z'),
					title: 'Apostila local',
					notebookId: '44444444-4444-4444-8444-444444444444',
					pageCount: 2,
					status: 'processing'
				},
				2,
				[
					{
						documentId,
						pageNumber: 1,
						nativeText: 'texto nativo',
						status: 'ready',
						updatedAtMs: Date.parse('2026-08-02T02:00:00.000Z')
					},
					{
						documentId,
						pageNumber: 2,
						nativeText: null,
						status: 'processing',
						updatedAtMs: Date.parse('2026-08-02T02:00:00.000Z')
					}
				]
			)
		).toMatchObject({
			title: 'Apostila local',
			kind: 'pdf',
			status: 'processing',
			pageCount: 2,
			notebookId: '44444444-4444-4444-8444-444444444444',
			originalReference: {
				provider: 'google_drive',
				driveFileId: pageDriveFileId
			},
			pages: [
				{ pageNumber: 1, status: 'ready' },
				{ pageNumber: 2, status: 'processing' }
			]
		});
	});
});

describe('document detail response contract', () => {
	it('rejects a mismatched document or malformed page index', async () => {
		const mismatched = gateway();
		mismatched.value.loadDocument = async () => ({
			id: '33333333-3333-4333-8333-333333333333',
			title: 'Apostila',
			kind: 'pdf',
			status: 'ready',
			page_count: 1,
			notebook_id: null,
			original_filename: 'apostila.pdf',
			storage_path: 'user/document/original.pdf',
			created_at: '2026-08-02T03:00:00.000Z',
			updated_at: '2026-08-02T04:00:00.000Z'
		});
		await expect(loadDocumentDetailWithGateway(documentId, mismatched.value)).rejects.toMatchObject(
			{
				name: 'DocumentDetailError',
				code: 'unavailable'
			}
		);

		const malformedPage = gateway();
		malformedPage.value.listPageSummaries = async () => [
			pageSummary({ updated_at: '2026-02-30T00:00:00.000Z' })
		];
		await expect(
			loadDocumentDetailWithGateway(documentId, malformedPage.value)
		).rejects.toMatchObject({ name: 'DocumentDetailError', code: 'unavailable' });
	});

	it('rejects malformed page detail separately from the lightweight shell', async () => {
		const malformedPage = gateway();
		malformedPage.value.loadPage = async () => pageRecord({ warnings: [{ raw: true }] as never });
		await expect(
			loadDocumentPageWithGateway(documentId, 1, malformedPage.value)
		).rejects.toMatchObject({ name: 'DocumentDetailError', code: 'unavailable' });
	});

	it('normalizes gateway failures without leaking details', async () => {
		const fixture = gateway();
		fixture.value.loadDocument = async () => {
			throw new Error('internal documents host');
		};

		await expect(loadDocumentDetailWithGateway(documentId, fixture.value)).rejects.toEqual(
			expect.objectContaining({
				name: 'DocumentDetailError',
				code: 'unavailable',
				message: 'Não foi possível abrir o documento agora.'
			})
		);
	});
});
