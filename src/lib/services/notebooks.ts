import type { SupabaseClient } from '@supabase/supabase-js';
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

type RpcError = { message: string };
type NotebookRpcClient = {
	rpc(name: 'list_notebooks'): Promise<{ data: NotebookRecord[] | null; error: RpcError | null }>;
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
	const { data, error } = await client.auth.getSession();
	if (error || data.session === null) throw new NotebookServiceError();
	return data.session.user.id;
}

export async function listNotebooks(
	client?: SupabaseClient<Database>
): Promise<readonly NotebookSummary[]> {
	const rpc = clientOrDefault(client) as unknown as NotebookRpcClient;
	const { data, error } = await rpc.rpc('list_notebooks');
	if (error || !Array.isArray(data)) throw new NotebookServiceError();
	return Object.freeze(data.map(mapNotebookRecord));
}

export async function createNotebook(
	input: NewNotebookInput,
	client?: SupabaseClient<Database>
): Promise<NotebookSummary> {
	const resolvedClient = clientOrDefault(client);
	const userId = await currentUserId(resolvedClient);
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
	return mapNotebookRecord({
		...(data as unknown as Omit<NotebookRecord, 'document_count'>),
		document_count: 0
	});
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

	const { error } = await resolvedClient
		.from('notebooks')
		.update(changes)
		.eq('id', validId(notebookId));
	if (error) throw new NotebookServiceError();

	const refreshed = await listNotebooks(resolvedClient);
	const notebook = refreshed.find((item) => item.id === notebookId);
	if (!notebook) throw new NotebookServiceError();
	return notebook;
}

export async function deleteNotebook(
	notebookId: string,
	client?: SupabaseClient<Database>
): Promise<void> {
	const rpc = clientOrDefault(client) as unknown as NotebookRpcClient;
	const { data, error } = await rpc.rpc('delete_notebook', {
		target_notebook_id: validId(notebookId)
	});
	if (error || data !== true) throw new NotebookServiceError();
}
