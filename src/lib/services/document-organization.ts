import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DocumentOrganization = {
	id: string;
	title: string;
	notebookId: string | null;
	updatedAt: string;
};

export type DocumentOrganizationClientLike = {
	from(table: 'documents'): {
		update(input: { title: string; notebook_id: string | null }): {
			eq(
				column: 'id',
				value: string
			): {
				select(columns?: string): {
					maybeSingle(): Promise<{
						data: {
							id: string;
							title: string;
							notebook_id: string | null;
							updated_at: string;
						} | null;
						error: unknown;
					}>;
				};
			};
		};
	};
};

export class DocumentOrganizationError extends Error {
	constructor() {
		super('Não foi possível atualizar a organização do documento.');
		this.name = 'DocumentOrganizationError';
	}
}

function defaultClient(): DocumentOrganizationClientLike {
	return getSupabaseClient() as unknown as DocumentOrganizationClientLike;
}

function validId(value: string, label: 'document' | 'notebook') {
	if (!UUID.test(value)) throw new TypeError(`Invalid ${label} identifier`);
	return value;
}

export async function updateDocumentOrganization(
	documentId: string,
	input: { title: string; notebookId: string | null },
	client: DocumentOrganizationClientLike = defaultClient()
): Promise<DocumentOrganization> {
	validId(documentId, 'document');
	const title = input.title.trim();
	if (title.length < 1 || title.length > 240 || /[\u0000-\u001f\u007f]/u.test(title)) {
		throw new TypeError('Invalid document title');
	}
	const notebookId = input.notebookId === null ? null : validId(input.notebookId, 'notebook');
	const { data, error } = await client
		.from('documents')
		.update({ title, notebook_id: notebookId })
		.eq('id', documentId)
		.select('id,title,notebook_id,updated_at')
		.maybeSingle();
	if (error || data === null) throw new DocumentOrganizationError();
	return Object.freeze({
		id: data.id,
		title: data.title,
		notebookId: data.notebook_id,
		updatedAt: data.updated_at
	});
}

export function typedDocumentOrganizationClient(
	client: SupabaseClient<Database> = getSupabaseClient()
): DocumentOrganizationClientLike {
	return client as unknown as DocumentOrganizationClientLike;
}
