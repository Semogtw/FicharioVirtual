import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

export class OcrConsentError extends Error {
	constructor() {
		super('Não foi possível registrar o consentimento de leitura automática.');
		this.name = 'OcrConsentError';
	}
}

export async function recordOcrConsent(
	version = 1,
	client?: SupabaseClient<Database>
): Promise<void> {
	if (!Number.isInteger(version) || version < 1 || version > 1000) {
		throw new TypeError('Invalid OCR consent version');
	}
	type ConsentClient = {
		rpc(
			name: 'record_ocr_consent',
			args: { consent_version: number }
		): Promise<{ data: boolean | null; error: unknown }>;
	};
	const gateway = (client ?? getSupabaseClient()) as unknown as ConsentClient;
	let result: { data: boolean | null; error: unknown };
	try {
		result = await gateway.rpc('record_ocr_consent', { consent_version: version });
	} catch {
		throw new OcrConsentError();
	}
	if (result.error || result.data !== true) throw new OcrConsentError();
}
