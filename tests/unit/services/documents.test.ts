import { describe, expect, it } from 'vitest';
import {
	mapDocumentRecord,
	type DocumentPage,
	type DocumentSummary
} from '../../../src/lib/domain/document';
import { mapNotebookRecord } from '../../../src/lib/domain/notebook';
import {
	collectAllDocumentPages,
	DocumentServiceError
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
