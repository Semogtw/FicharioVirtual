import { describe, expect, it } from 'vitest';
import {
	mapDocumentRecord,
	type DocumentPage,
	type DocumentSummary
} from '../../../src/lib/domain/document';
import { mapNotebookRecord } from '../../../src/lib/domain/notebook';
import {
	collectAllDocumentPages,
	DocumentServiceError,
	parseDocumentRecord,
	parseDocumentRecords
} from '../../../src/lib/services/documents';

function document(id: string, createdAt: string): DocumentSummary {
	return Object.freeze({
		id,
		title: `Document ${id}`,
		kind: 'image',
		status: 'ready',
		pageCount: 1,
		thumbnailPath: null,
		notebookId: null,
		createdAt,
		updatedAt: createdAt
	});
}

describe('document mapping', () => {
	it('maps database fields into a UI-safe camelCase summary', () => {
		const summary = mapDocumentRecord({
			id: 'document-1',
			title: 'Fotossíntese',
			kind: 'pdf',
			status: 'ready',
			page_count: 12,
			thumbnail_path: 'user/document/thumb.webp',
			notebook_id: 'notebook-1',
			created_at: '2026-08-02T01:00:00.000Z',
			updated_at: '2026-08-02T02:00:00.000Z'
		});

		expect(summary).toEqual({
			id: 'document-1',
			title: 'Fotossíntese',
			kind: 'pdf',
			status: 'ready',
			pageCount: 12,
			thumbnailPath: 'user/document/thumb.webp',
			notebookId: 'notebook-1',
			createdAt: '2026-08-02T01:00:00.000Z',
			updatedAt: '2026-08-02T02:00:00.000Z'
		});
		expect(summary).not.toHaveProperty('storage_path');
		expect(summary).not.toHaveProperty('user_id');
	});
});

describe('collectAllDocumentPages', () => {
	it('loads every cursor page in order', async () => {
		const firstCursor = {
			createdAt: '2026-08-02T09:00:00.000Z',
			id: '11111111-1111-4111-8111-111111111111'
		};
		const calls: Array<null | typeof firstCursor> = [];
		const pages: DocumentPage[] = [
			{
				items: [document('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-08-02T10:00:00.000Z')],
				nextCursor: firstCursor
			},
			{
				items: [document('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', firstCursor.createdAt)],
				nextCursor: null
			}
		];

		const result = await collectAllDocumentPages(async (cursor) => {
			calls.push(cursor);
			const page = pages.shift();
			if (!page) throw new Error('unexpected page request');
			return page;
		});

		expect(calls).toEqual([null, firstCursor]);
		expect(result.map((item) => item.id)).toEqual([
			'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
		]);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it('rejects a repeated cursor instead of looping forever', async () => {
		const repeatedCursor = {
			createdAt: '2026-08-02T09:00:00.000Z',
			id: '11111111-1111-4111-8111-111111111111'
		};

		await expect(
			collectAllDocumentPages(async () => ({ items: [], nextCursor: repeatedCursor }))
		).rejects.toBeInstanceOf(DocumentServiceError);
	});
});

describe('notebook mapping', () => {
	it('maps counts supplied by the aggregate query', () => {
		expect(
			mapNotebookRecord({
				id: 'notebook-1',
				name: 'Biologia',
				description: null,
				cover_style: 'linen',
				created_at: '2026-08-02T01:00:00.000Z',
				updated_at: '2026-08-02T02:00:00.000Z',
				document_count: 4
			})
		).toEqual({
			id: 'notebook-1',
			name: 'Biologia',
			description: null,
			coverStyle: 'linen',
			documentCount: 4,
			createdAt: '2026-08-02T01:00:00.000Z',
			updatedAt: '2026-08-02T02:00:00.000Z'
		});
	});
});

describe('document record response contract', () => {
	const documentId = '11111111-1111-4111-8111-111111111111';
	const notebookId = '22222222-2222-4222-8222-222222222222';

	function row(overrides: Record<string, unknown> = {}) {
		return {
			id: documentId,
			title: 'Fotossíntese',
			kind: 'pdf',
			status: 'ready',
			page_count: 12,
			thumbnail_path: 'user/document/thumb.webp',
			notebook_id: notebookId,
			created_at: '2026-08-02T01:00:00.000Z',
			updated_at: '2026-08-02T02:00:00.000Z',
			...overrides
		};
	}

	it('accepts and freezes exact document rows', () => {
		const result = parseDocumentRecords([row()], 61);

		expect(result).toEqual([row()]);
		expect(Object.isFrozen(result)).toBe(true);
		expect(result.every(Object.isFrozen)).toBe(true);
	});

	it('requires an updated record to preserve the requested identity', () => {
		expect(parseDocumentRecord(row(), documentId)).toEqual(row());
		expect(() => parseDocumentRecord(row({ id: notebookId }), documentId)).toThrow(
			'Invalid document response'
		);
	});

	it('rejects malformed, extra or duplicate document rows', () => {
		const missingId = { ...row() } as Record<string, unknown>;
		delete missingId.id;

		expect(() => parseDocumentRecords([missingId], 61)).toThrow('Invalid document response');
		expect(() => parseDocumentRecords([row({ kind: 'text' })], 61)).toThrow(
			'Invalid document response'
		);
		expect(() => parseDocumentRecords([row({ created_at: 'invalid-date' })], 61)).toThrow(
			'Invalid document response'
		);
		expect(() => parseDocumentRecords([row({ private_content: 'no' })], 61)).toThrow(
			'Invalid document response'
		);
		expect(() => parseDocumentRecords([row(), row()], 61)).toThrow('Invalid document response');
	});

	it('rejects result sets larger than the requested query bound', () => {
		expect(() => parseDocumentRecords([row(), row({ id: notebookId })], 1)).toThrow(
			'Invalid document response'
		);
	});
});
