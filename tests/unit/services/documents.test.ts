import { describe, expect, it } from 'vitest';
import { mapDocumentRecord } from '../../../src/lib/domain/document';
import { mapNotebookRecord } from '../../../src/lib/domain/notebook';

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
