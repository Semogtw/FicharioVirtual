import { z } from 'zod';
import { getSupabaseClient } from '$lib/services/supabase';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const responseSchema = z
	.object({
		folderId: z.string().regex(DRIVE_ID)
	})
	.strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DriveFolderClientLike = {
	functions: {
		invoke(
			name: 'drive-resolve-folder',
			options: { body: { notebookId: string | null } }
		): Promise<{ data: unknown; error: unknown }>;
	};
};

export class DriveFolderResolutionError extends Error {
	constructor() {
		super('Não foi possível preparar a pasta do Google Drive.');
		this.name = 'DriveFolderResolutionError';
	}
}

export async function resolveDriveFolder(
	notebookId: string | null,
	client: DriveFolderClientLike = getSupabaseClient() as unknown as DriveFolderClientLike
): Promise<string> {
	if (notebookId !== null && !UUID.test(notebookId)) {
		throw new TypeError('Invalid notebook identifier');
	}
	try {
		const { data, error } = await client.functions.invoke('drive-resolve-folder', {
			body: { notebookId }
		});
		if (error) throw error;
		return responseSchema.parse(data).folderId;
	} catch (error) {
		if (error instanceof TypeError && error.message === 'Invalid notebook identifier') throw error;
		throw new DriveFolderResolutionError();
	}
}
