import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

export class OcrBackgroundKickError extends Error {
	constructor() {
		super('Não foi possível iniciar a leitura em segundo plano agora.');
		this.name = 'OcrBackgroundKickError';
	}
}

let defaultKick: Promise<boolean> | null = null;

function acceptedResponse(value: unknown) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		(value as Record<string, unknown>).accepted === true
	);
}

async function performKick(client: SupabaseClient<Database>) {
	try {
		const { data, error } = await client.functions.invoke('ocr-queue-kick', { body: {} });
		if (error || !acceptedResponse(data)) throw new OcrBackgroundKickError();
		return true;
	} catch (error) {
		if (error instanceof OcrBackgroundKickError) throw error;
		throw new OcrBackgroundKickError();
	}
}

export function kickOcrQueue(client?: SupabaseClient<Database>): Promise<boolean> {
	if (client) return performKick(client);
	if (defaultKick) return defaultKick;
	const pending = performKick(getSupabaseClient()).finally(() => {
		if (defaultKick === pending) defaultKick = null;
	});
	defaultKick = pending;
	return pending;
}

export function kickOcrQueueBestEffort(client?: SupabaseClient<Database>) {
	void kickOcrQueue(client).catch(() => undefined);
}
