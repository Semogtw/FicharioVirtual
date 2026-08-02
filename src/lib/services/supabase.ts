import { env } from '$env/dynamic/public';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parsePublicEnv } from '$lib/env/public';
import type { Database } from '$lib/types/database';

let browserClient: SupabaseClient<Database> | null = null;

export function createBrowserSupabaseClient(
	source: Record<string, string | undefined> = env
): SupabaseClient<Database> {
	const configuration = parsePublicEnv(source);

	return createClient<Database>(
		configuration.PUBLIC_SUPABASE_URL,
		configuration.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
		{
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: true
			},
			global: {
				headers: {
					'X-Client-Info': 'fichario-virtual/0.1.0'
				}
			}
		}
	);
}

export function getSupabaseClient(): SupabaseClient<Database> {
	browserClient ??= createBrowserSupabaseClient();
	return browserClient;
}
