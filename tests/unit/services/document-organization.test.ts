import { describe, expect, it } from 'vitest';
import {
	updateDocumentOrganization,
	type DocumentOrganizationClientLike
} from '../../../src/lib/services/document-organization';

const documentId = '11111111-1111-4111-8111-111111111111';
const notebookId = '22222222-2222-4222-8222-222222222222';

function client() {
	let update: Record<string, unknown> | null = null;
	let selectedId: string | null = null;
	const value: DocumentOrganizationClientLike = {
		from(table) {
			expect(table).toBe('documents');
			return {
				update(input) {
					update = input;
					return this;
				},
				eq(column, value) {
					expect(column).toBe('id');
					selectedId = value;
					return this;
				},
				select() {
					return this;
				},
				async maybeSingle() {
					return {
						data: {
							id: documentId,
							title: update?.title,
							notebook_id: update?.notebook_id,
							updated_at: '2026-08-02T10:00:00.000Z'
						},
						error: null
					};
				}
			};
		}
	};
	return {
		value,
		get update() {
			return update;
		},
		get selectedId() {
			return selectedId;
		}
	};
}

describe('updateDocumentOrganization', () => {
	it('trims title and persists an optional notebook', async () => {
		const fixture = client();
		await expect(
			updateDocumentOrganization(documentId, { title: '  Mitose  ', notebookId }, fixture.value)
		).resolves.toEqual({
			id: documentId,
			title: 'Mitose',
			notebookId,
			updatedAt: '2026-08-02T10:00:00.000Z'
		});
		expect(fixture.update).toEqual({ title: 'Mitose', notebook_id: notebookId });
		expect(fixture.selectedId).toBe(documentId);
	});

	it('supports removing a document from its notebook', async () => {
		const fixture = client();
		await updateDocumentOrganization(
			documentId,
			{ title: 'Avulso', notebookId: null },
			fixture.value
		);
		expect(fixture.update).toEqual({ title: 'Avulso', notebook_id: null });
	});

	it('rejects empty titles and invalid identifiers before the update', async () => {
		await expect(
			updateDocumentOrganization(documentId, { title: ' ', notebookId: null })
		).rejects.toThrow('Invalid document title');
		await expect(
			updateDocumentOrganization('bad', { title: 'Título', notebookId: null })
		).rejects.toThrow('Invalid document identifier');
	});
});
