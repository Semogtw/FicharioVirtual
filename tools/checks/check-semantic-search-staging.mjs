#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

function env(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing ${name}`);
	return value;
}

function safeCode(value) {
	return typeof value === 'string' && /^[a-z][a-z0-9_]{1,95}$/.test(value) ? value : null;
}

async function diagnostic(error) {
	const context = error?.context;
	if (!(context instanceof Response)) {
		return { status: null, code: null, message: error?.message ?? 'unknown_function_error' };
	}
	let code = null;
	try {
		const body = await context.clone().json();
		code = safeCode(body?.code);
	} catch {
		// The response body is intentionally not emitted when it is not the expected safe JSON shape.
	}
	return { status: context.status, code, message: error?.message ?? 'function_http_error' };
}

async function main() {
	const supabase = createClient(env('STAGING_SUPABASE_URL'), env('STAGING_SUPABASE_PUBLISHABLE_KEY'), {
		auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
	});
	try {
		const login = await supabase.auth.signInWithPassword({
			email: env('STAGING_AUTHORIZED_EMAIL'),
			password: env('STAGING_AUTHORIZED_PASSWORD')
		});
		if (login.error || !login.data.user) throw new Error(`Sign-in failed: ${login.error?.message ?? 'no user'}`);

		const startedAt = performance.now();
		const result = await supabase.functions.invoke('semantic-search', {
			body: { query: 'FICHARIO semantic staging probe', notebookId: null, limit: 5, offset: 0 }
		});
		const durationMs = Math.round(performance.now() - startedAt);
		if (result.error) {
			const detail = await diagnostic(result.error);
			console.error(
				`FAIL semantic-search status=${detail.status ?? 'unknown'} code=${detail.code ?? 'unknown'} durationMs=${durationMs} message=${detail.message}`
			);
			process.exitCode = 1;
			return;
		}
		console.log(
			`PASS semantic-search mode=${result.data?.mode ?? 'unknown'} reason=${result.data?.reason ?? 'none'} results=${Array.isArray(result.data?.results) ? result.data.results.length : 'invalid'} durationMs=${durationMs}`
		);
	} finally {
		await supabase.auth.signOut().catch(() => undefined);
	}
}

main().catch((error) => {
	console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
