import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TagSummary = {
	id: string;
	name: string;
	documentCount: number;
	createdAt: string;
	updatedAt: string;
};

type TagRow = {
	tag_id: string;
	name: string;
	document_count: number;
	created_at: string;
	updated_at: string;
};

export type TagsClientLike = {
	rpc(
		name:
			| 'list_tags'
			| 'create_tag'
			| 'rename_tag'
			| 'delete_tag'
			| 'list_tag_document_ids'
			| 'set_tag_membership',
		args?: Record<string, unknown>
	): Promise<{ data: unknown; error: unknown }>;
};

export class TagServiceError extends Error {
	constructor(message = 'Não foi possível atualizar as tags agora.') {
		super(message);
		this.name = 'TagServiceError';
	}
}

function defaultClient(): TagsClientLike {
	return getSupabaseClient() as unknown as TagsClientLike;
}

function id(value: string, label: 'tag' | 'document') {
	if (!UUID.test(value)) throw new TypeError(`Invalid ${label} identifier`);
	return value;
}

function tagName(value: string) {
	const normalized = value.trim();
	if (
		normalized.length < 1 ||
		normalized.length > 120 ||
		/[\u0000-\u001f\u007f]/u.test(normalized)
	) {
		throw new TypeError('Invalid tag name');
	}
	return normalized;
}

export async function listTags(client?: TagsClientLike): Promise<readonly TagSummary[]> {
	const gateway = client ?? defaultClient();
	const { data, error } = await gateway.rpc('list_tags');
	if (error || !Array.isArray(data))
		throw new TagServiceError('Não foi possível carregar as tags.');
	return Object.freeze(
		(data as TagRow[]).map((row) =>
			Object.freeze({
				id: row.tag_id,
				name: row.name,
				documentCount: Number(row.document_count),
				createdAt: row.created_at,
				updatedAt: row.updated_at
			})
		)
	);
}

export async function createTag(name: string, client?: TagsClientLike) {
	const normalizedName = tagName(name);
	const gateway = client ?? defaultClient();
	const { data, error } = await gateway.rpc('create_tag', { tag_name: normalizedName });
	if (error || typeof data !== 'string' || !UUID.test(data)) throw new TagServiceError();
	return data;
}

export async function renameTag(tagId: string, name: string, client?: TagsClientLike) {
	const validatedTagId = id(tagId, 'tag');
	const normalizedName = tagName(name);
	const gateway = client ?? defaultClient();
	const { data, error } = await gateway.rpc('rename_tag', {
		target_tag_id: validatedTagId,
		tag_name: normalizedName
	});
	if (error || data !== true) throw new TagServiceError();
}

export async function deleteTag(tagId: string, client?: TagsClientLike) {
	const validatedTagId = id(tagId, 'tag');
	const gateway = client ?? defaultClient();
	const { data, error } = await gateway.rpc('delete_tag', { target_tag_id: validatedTagId });
	if (error || data !== true) throw new TagServiceError();
}

export async function listTagDocumentIds(
	tagId: string,
	client?: TagsClientLike
): Promise<ReadonlySet<string>> {
	const validatedTagId = id(tagId, 'tag');
	const gateway = client ?? defaultClient();
	const { data, error } = await gateway.rpc('list_tag_document_ids', {
		target_tag_id: validatedTagId
	});
	if (error || !Array.isArray(data)) throw new TagServiceError();
	return new Set(
		(data as Array<{ document_id?: unknown }>).flatMap((row) =>
			typeof row.document_id === 'string' && UUID.test(row.document_id) ? [row.document_id] : []
		)
	);
}

export async function setTagMembership(
	tagId: string,
	documentId: string,
	assigned: boolean,
	client?: TagsClientLike
) {
	if (typeof assigned !== 'boolean') throw new TypeError('Invalid tag assignment');
	const validatedTagId = id(tagId, 'tag');
	const validatedDocumentId = id(documentId, 'document');
	const gateway = client ?? defaultClient();
	const { data, error } = await gateway.rpc('set_tag_membership', {
		target_tag_id: validatedTagId,
		target_document_id: validatedDocumentId,
		assigned
	});
	if (error || data !== true) throw new TagServiceError();
}
