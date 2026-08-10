import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

export class OcrBackgroundKickError extends Error {
	constructor() {
		super('Não foi possível iniciar a leitura em segundo plano agora.');
		this.name = 'OcrBackgroundKickError';
	}
}

function acceptedResponse(value: unknown) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		(value as Record<string, unknown>).accepted === true
	);
}

export async function kickOcrQueue(client: SupabaseClient<Database> = getSupabaseClient()) {
	try {
		const { data, error } = await client.functions.invoke('ocr-queue-kick', { body: {} });
		if (error || !acceptedResponse(data)) throw new OcrBackgroundKickError();
		return true;
	} catch (error) {
		if (error instanceof OcrBackgroundKickError) throw error;
		throw new OcrBackgroundKickError();
	}
}

export function kickOcrQueueBestEffort(client?: SupabaseClient<Database>) {
	void kickOcrQueue(client).catch(() => undefined);
}
