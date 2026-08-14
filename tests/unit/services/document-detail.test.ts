import { describe, expect, it } from 'vitest';
import {
	loadDocumentDetailWithGateway,
	savePageCorrectionWithGateway,
	type DocumentDetailGateway,
	type DocumentDetailRecord
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

function gateway(documentOverrides: Partial<DocumentDetailRecord> = {}) {
	let correction: Record<string, unknown> | null = null;
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
		async listPages() {
			return [pageRecord()];
		},
		async createSignedUrl(path) {
			return `https://private.test/${path}?signed=1`;
		},
		async saveCorrection(_pageId, input) {
			correction = input;
			return pageRecord({
				corrected_text: input.correctedText,
				extraction_source: 'manual',
				status: input.status,
				was_manually_reviewed: true
			});
		}
	};
	return {
		value,
		get correction() {
			return correction;
		}
	};
}

describe('loadDocumentDetailWithGateway', () => {
	it('returns safe metadata, mapped pages and an expiring URL', async () => {
		const fixture = gateway();
		const detail = await loadDocumentDetailWithGateway(documentId, fixture.value);

		expect(detail.originalUrl).toContain('signed=1');
		expect(detail.originalReference).toEqual({
			provider: 'supabase',
			url: detail.originalUrl,
			driveFileId: null
		});
		expect(detail.pages[0]?.text).toBe('Texto nativo');
		expect(detail.pages[0]?.sourceDriveFileId).toBeNull();
		expect(detail).not.toHaveProperty('storagePath');
	});

	it('maps a Drive original for each image page', async () => {
		const fixture = gateway({
			kind: 'image',
			storage_path: null,
			drive_file_id: pageDriveFileId,
			physical_state: 'available',
			original_filename: 'pagina-1.jpg'
		});
		fixture.value.listPages = async () => [
			pageRecord({ extraction_source: 'ocr', source_drive_file_id: pageDriveFileId })
		];
		const detail = await loadDocumentDetailWithGateway(documentId, fixture.value);

		expect(detail.pages[0]?.sourceDriveFileId).toBe(pageDriveFileId);
	});

	it('resolves a Drive reference when no Storage copy exists without persisting a token', async () => {
		const fixture = gateway({
			storage_path: null,
			drive_file_id: pageDriveFileId,
			physical_state: 'available'
		});
		const detail = await loadDocumentDetailWithGateway(documentId, fixture.value);

		expect(detail.originalUrl).toBe(
			`https://drive.google.com/file/d/${pageDriveFileId}/view`
		);
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

describe('savePageCorrectionWithGateway', () => {
	it('saves non-empty text as a reviewed manual source', async () => {
		const fixture = gateway();
		const page = await savePageCorrectionWithGateway(pageId, 'Texto\n corrigido', fixture.value);

		expect(fixture.correction).toEqual({ correctedText: 'Texto\n corrigido', status: 'ready' });
		expect(page.wasManuallyReviewed).toBe(true);
		expect(page.text).toBe('Texto\n corrigido');
	});

	it('stores an empty correction as null and keeps the page in review', async () => {
		const fixture = gateway();
		await savePageCorrectionWithGateway(pageId, '   ', fixture.value);

		expect(fixture.correction).toEqual({ correctedText: null, status: 'needs_review' });
	});
});

describe('document detail response contract', () => {
	it('rejects a mismatched document or malformed page collection', async () => {
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
		malformedPage.value.listPages = async () => [
			pageRecord({ warnings: [{ raw: true }] as never })
		];
		await expect(
			loadDocumentDetailWithGateway(documentId, malformedPage.value)
		).rejects.toMatchObject({ name: 'DocumentDetailError', code: 'unavailable' });

		const impossibleTimestamp = gateway();
		impossibleTimestamp.value.listPages = async () => [
			pageRecord({ updated_at: '2026-02-30T00:00:00.000Z' })
		];
		await expect(
			loadDocumentDetailWithGateway(documentId, impossibleTimestamp.value)
		).rejects.toMatchObject({ name: 'DocumentDetailError', code: 'unavailable' });
	});

	it('rejects a correction response that does not match the requested page', async () => {
		const fixture = gateway();
		fixture.value.saveCorrection = async (_pageId, input) =>
			pageRecord({
				id: '33333333-3333-4333-8333-333333333333',
				corrected_text: input.correctedText,
				extraction_source: 'manual',
				status: input.status,
				was_manually_reviewed: true
			});

		await expect(
			savePageCorrectionWithGateway(pageId, 'Corrigido', fixture.value)
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
