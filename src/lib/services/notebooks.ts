import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
	mapNotebookRecord,
	type NewNotebookInput,
	type NotebookRecord,
	type NotebookSummary,
	type UpdateNotebookInput
} from '$lib/domain/notebook';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const notebookRecordSchema = z
	.object({
		id: z.string().regex(UUID),
		name: z.string().trim().min(1).max(120),
		description: z.string().max(2_000).nullable(),
		cover_style: z.string().trim().min(1).max(64),
		created_at: timestamp,
		updated_at: timestamp
	})
	.strict();
const notebookSummaryRecordSchema = notebookRecordSchema.extend({
	document_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
});

type NotebookBaseRecord = z.infer<typeof notebookRecordSchema>;

export function parseNotebookRecords(data: unknown): readonly NotebookRecord[] {
	const result = z.array(notebookSummaryRecordSchema).max(1_000).safeParse(data);
	if (!result.success) throw new TypeError('Invalid notebook response');
	const ids = new Set<string>();
	const rows = result.data.map((row) => {
		if (ids.has(row.id)) throw new TypeError('Invalid notebook response');
		ids.add(row.id);
		return Object.freeze(row);
	});
	return Object.freeze(rows);
}

export function parseNotebookRecord(data: unknown, expectedId?: string): NotebookBaseRecord {
	const result = notebookRecordSchema.safeParse(data);
	if (!result.success || (expectedId !== undefined && result.data.id !== expectedId)) {
		throw new TypeError('Invalid notebook response');
	}
	return Object.freeze(result.data);
}

type RpcError = { message: string };
type NotebookRpcClient = {
	rpc(name: 'list_notebooks'): Promise<{ data: unknown; error: RpcError | null }>;
	rpc(
		name: 'delete_notebook',
		args: { target_notebook_id: string }
	): Promise<{ data: boolean | null; error: RpcError | null }>;
};

export class NotebookServiceError extends Error {
	constructor() {
		super('Não foi possível atualizar os cadernos agora.');
		this.name = 'NotebookServiceError';
	}
}

function clientOrDefault(client?: SupabaseClient<Database>) {
	return client ?? getSupabaseClient();
}

function validId(value: string): string {
	if (!UUID.test(value)) throw new TypeError('Invalid notebook identifier');
	return value;
}

async function currentUserId(client: SupabaseClient<Database>): Promise<string> {
	try {
		const { data, error } = await client.auth.getSession();
		if (error || data.session === null || !UUID.test(data.session.user.id)) {
			throw new NotebookServiceError();
		}
		return data.session.user.id;
	} catch {
		throw new NotebookServiceError();
	}
}

export async function listNotebooks(
	client?: SupabaseClient<Database>
): Promise<readonly NotebookSummary[]> {
	try {
		const rpc = clientOrDefault(client) as unknown as NotebookRpcClient;
		const { data, error } = await rpc.rpc('list_notebooks');
		if (error) throw new NotebookServiceError();
		return Object.freeze(parseNotebookRecords(data).map(mapNotebookRecord));
	} catch {
		throw new NotebookServiceError();
	}
}

export async function createNotebook(
	input: NewNotebookInput,
	client?: SupabaseClient<Database>
): Promise<NotebookSummary> {
	const resolvedClient = clientOrDefault(client);
	const userId = await currentUserId(resolvedClient);
	try {
		const { data, error } = await resolvedClient
			.from('notebooks')
			.insert({
				user_id: userId,
				name: input.name.trim(),
				description: input.description?.trim() || null,
				cover_style: input.coverStyle ?? 'linen'
			})
			.select('id,name,description,cover_style,created_at,updated_at')
			.single();

		if (error || data === null) throw new NotebookServiceError();
		return mapNotebookRecord({ ...parseNotebookRecord(data), document_count: 0 });
	} catch {
		throw new NotebookServiceError();
	}
}

export async function updateNotebook(
	notebookId: string,
	input: UpdateNotebookInput,
	client?: SupabaseClient<Database>
): Promise<NotebookSummary> {
	const resolvedClient = clientOrDefault(client);
	const changes: Database['public']['Tables']['notebooks']['Update'] = {};
	if (input.name !== undefined) changes.name = input.name.trim();
	if (input.description !== undefined) changes.description = input.description?.trim() || null;
	if (input.coverStyle !== undefined) changes.cover_style = input.coverStyle;

	const validatedNotebookId = validId(notebookId);
	try {
		const { error } = await resolvedClient
			.from('notebooks')
			.update(changes)
			.eq('id', validatedNotebookId);
		if (error) throw new NotebookServiceError();

		const refreshed = await listNotebooks(resolvedClient);
		const notebook = refreshed.find((item) => item.id === validatedNotebookId);
		if (!notebook) throw new NotebookServiceError();
		return notebook;
	} catch {
		throw new NotebookServiceError();
	}
}

export async function deleteNotebook(
	notebookId: string,
	client?: SupabaseClient<Database>
): Promise<void> {
	const validatedNotebookId = validId(notebookId);
	try {
		const rpc = clientOrDefault(client) as unknown as NotebookRpcClient;
		const { data, error } = await rpc.rpc('delete_notebook', {
			target_notebook_id: validatedNotebookId
		});
		if (error || data !== true) throw new NotebookServiceError();
	} catch {
		throw new NotebookServiceError();
	}
}
