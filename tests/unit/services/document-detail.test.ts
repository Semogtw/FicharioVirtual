import { describe, expect, it } from 'vitest';
import {
	loadDocumentDetailWithGateway,
	loadDocumentPreviewWithGateway,
	loadDocumentPageWithGateway,
	type DocumentDetailGateway,
	type DocumentDetailRecord,
	type DocumentPageSummaryRecord
} from '../../../src/lib/services/document-detail';
import type { PageRecord } from '../../../src/lib/domain/page';

const documentId = '11111111-1111-4111-8111-111111111111';
const pageId = '22222222-2222-4222-8222-222222222222';
const pageDriveFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

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
