import { z } from 'zod';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeName = z
	.string()
	.min(1)
	.max(120)
	.refine((value) => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value));
const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const tagRowSchema = z
	.object({
		tag_id: z.string().regex(UUID),
		name: safeName,
		document_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
		created_at: timestamp,
		updated_at: timestamp
	})
	.strict();
const tagRowsSchema = z.array(tagRowSchema).max(1_000);
const membershipRowSchema = z.object({ document_id: z.string().regex(UUID) }).strict();
const membershipRowsSchema = z.array(membershipRowSchema).max(10_000);

type TagRow = z.infer<typeof tagRowSchema>;
type RpcName = Parameters<TagsClientLike['rpc']>[0];

export type TagSummary = {
	id: string;
	name: string;
	documentCount: number;
	createdAt: string;
	updatedAt: string;
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

async function rpcData<T>(
	name: RpcName,
	args: Record<string, unknown> | undefined,
	client: TagsClientLike | undefined,
	parse: (data: unknown) => T,
	message?: string
): Promise<T> {
	try {
		const gateway = client ?? defaultClient();
		const { data, error } = await gateway.rpc(name, args);
		if (error) throw new TagServiceError(message);
		return parse(data);
	} catch {
		throw new TagServiceError(message);
	}
}

function mapTag(row: TagRow): TagSummary {
	return Object.freeze({
		id: row.tag_id,
		name: row.name,
		documentCount: row.document_count,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	});
}

function parseUuid(data: unknown) {
	if (typeof data !== 'string' || !UUID.test(data)) throw new TypeError('Invalid tag response');
	return data;
}

function parseTrue(data: unknown) {
	if (data !== true) throw new TypeError('Invalid tag response');
}

function parseDocumentIds(data: unknown): ReadonlySet<string> {
	const rows = membershipRowsSchema.parse(data);
	const ids = new Set<string>();
	for (const row of rows) {
		if (ids.has(row.document_id)) throw new TypeError('Duplicate tag membership');
		ids.add(row.document_id);
	}
	return ids;
}

export async function listTags(client?: TagsClientLike): Promise<readonly TagSummary[]> {
	return rpcData(
		'list_tags',
		undefined,
		client,
		(data) => Object.freeze(tagRowsSchema.parse(data).map(mapTag)),
		'Não foi possível carregar as tags.'
	);
}

export async function createTag(name: string, client?: TagsClientLike) {
	const normalizedName = tagName(name);
	return rpcData('create_tag', { tag_name: normalizedName }, client, parseUuid);
}

export async function renameTag(tagId: string, name: string, client?: TagsClientLike) {
	const validatedTagId = id(tagId, 'tag');
	const normalizedName = tagName(name);
	await rpcData(
		'rename_tag',
		{ target_tag_id: validatedTagId, tag_name: normalizedName },
		client,
		parseTrue
	);
}

export async function deleteTag(tagId: string, client?: TagsClientLike) {
	const validatedTagId = id(tagId, 'tag');
	await rpcData('delete_tag', { target_tag_id: validatedTagId }, client, parseTrue);
}

export async function listTagDocumentIds(
	tagId: string,
	client?: TagsClientLike
): Promise<ReadonlySet<string>> {
	const validatedTagId = id(tagId, 'tag');
	return rpcData(
		'list_tag_document_ids',
		{ target_tag_id: validatedTagId },
		client,
		parseDocumentIds
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
	await rpcData(
		'set_tag_membership',
		{
			target_tag_id: validatedTagId,
			target_document_id: validatedDocumentId,
			assigned
		},
		client,
		parseTrue
	);
}
