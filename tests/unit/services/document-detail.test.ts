import { describe, expect, it } from 'vitest';
import {
	loadDocumentDetailWithGateway,
	savePageCorrectionWithGateway,
	type DocumentDetailGateway
} from '../../../src/lib/services/document-detail';
import type { PageRecord } from '../../../src/lib/domain/page';

const documentId = '11111111-1111-4111-8111-111111111111';
const pageId = '22222222-2222-4222-8222-222222222222';

function pageRecord(overrides: Partial<PageRecord> = {}): PageRecord {
	return {
		id: pageId,
		page_number: 1,
		native_text: 'Texto nativo',
		ocr_raw_text: null,
		corrected_text: null,
		extraction_source: 'native_pdf',
		warnings: [],
		status: 'ready',
		was_manually_reviewed: false,
		updated_at: '2026-08-02T04:00:00.000Z',
		...overrides
	};
}

function gateway() {
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
				updated_at: '2026-08-02T04:00:00.000Z'
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
		expect(detail.pages[0]?.text).toBe('Texto nativo');
		expect(detail).not.toHaveProperty('storagePath');
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
