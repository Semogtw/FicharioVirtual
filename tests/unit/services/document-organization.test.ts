import { describe, expect, it } from 'vitest';
import {
	updateDocumentOrganization,
	type DocumentOrganizationClientLike
} from '../../../src/lib/services/document-organization';

const documentId = '11111111-1111-4111-8111-111111111111';
const notebookId = '22222222-2222-4222-8222-222222222222';

type OrganizationUpdate = { title: string; notebook_id: string | null };

function client() {
	let update: OrganizationUpdate | null = null;
	let selectedId: string | null = null;

	const value: DocumentOrganizationClientLike = {
		from(table) {
			expect(table).toBe('documents');
			return {
				update(input) {
					update = input;
					return {
						eq(column, value) {
							expect(column).toBe('id');
							selectedId = value;
							return {
								select() {
									return {
										async maybeSingle() {
											return {
												data: {
													id: documentId,
													title: input.title,
													notebook_id: input.notebook_id,
													updated_at: '2026-08-02T10:00:00.000Z'
												},
												error: null
											};
										}
									};
								}
							};
						}
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

describe('document organization response contract', () => {
	function responseClient(data: unknown, rejection?: unknown): DocumentOrganizationClientLike {
		return {
			from() {
				return {
					update() {
						return {
							eq() {
								return {
									select() {
										return {
											async maybeSingle() {
												if (rejection) throw rejection;
												return { data, error: null } as never;
											}
										};
									}
								};
							}
						};
					}
				};
			}
		};
	}

	it('rejects mismatched or malformed updated records', async () => {
		await expect(
			updateDocumentOrganization(
				documentId,
				{ title: 'Mitose', notebookId },
				responseClient({
					id: '33333333-3333-4333-8333-333333333333',
					title: 'Mitose',
					notebook_id: notebookId,
					updated_at: '2026-08-02T10:00:00.000Z'
				})
			)
		).rejects.toMatchObject({ name: 'DocumentOrganizationError' });

		await expect(
			updateDocumentOrganization(
				documentId,
				{ title: 'Mitose', notebookId },
				responseClient({
					id: documentId,
					title: 'Mitose',
					notebook_id: notebookId,
					updated_at: 'invalid-date',
					private_content: 'no'
				})
			)
		).rejects.toMatchObject({ name: 'DocumentOrganizationError' });
	});

	it('normalizes transport failures without leaking details', async () => {
		await expect(
			updateDocumentOrganization(
				documentId,
				{ title: 'Mitose', notebookId },
				responseClient(null, new Error('internal postgrest host'))
			)
		).rejects.toEqual(
			expect.objectContaining({
				name: 'DocumentOrganizationError',
				message: 'Não foi possível atualizar a organização do documento.'
			})
		);
	});
});
