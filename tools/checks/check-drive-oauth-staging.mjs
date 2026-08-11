#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_CLIENT_ID = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const OPAQUE = /^[A-Za-z0-9_-]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

function createStagingClient(url, publishableKey) {
	return createClient(url, publishableKey, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false
		}
	});
}

function assertCors(response, expectedOrigin, label) {
	const allowedOrigin = response.headers.get('access-control-allow-origin');
	if (allowedOrigin !== expectedOrigin) {
		throw new Error(
			`${label} CORS mismatch: expected ${expectedOrigin}, received ${allowedOrigin ?? '(missing)'}`
		);
	}
}

function assertAuthorizationUrl(value, supabaseUrl) {
	if (typeof value !== 'string') throw new Error('Drive OAuth start returned no authorization URL');

	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Drive OAuth start returned an invalid authorization URL');
	}

	if (
		url.protocol !== 'https:' ||
		url.hostname !== 'accounts.google.com' ||
		url.pathname !== '/o/oauth2/v2/auth'
	) {
		throw new Error('Drive OAuth start returned an unexpected Google authorization endpoint');
	}

	const clientId = url.searchParams.get('client_id') ?? '';
	if (!GOOGLE_CLIENT_ID.test(clientId)) throw new Error('Drive OAuth client ID is malformed');

	const redirectUri = url.searchParams.get('redirect_uri');
	if (!redirectUri) throw new Error('Drive OAuth redirect URI is missing');
	const redirect = new URL(redirectUri);
	const supabaseOrigin = new URL(supabaseUrl).origin;
	if (
		redirect.origin !== supabaseOrigin ||
		redirect.pathname !== '/functions/v1/drive-oauth-callback' ||
		redirect.search ||
		redirect.hash
	) {
		throw new Error('Drive OAuth redirect URI does not target the staging callback');
	}

	const scopes = (url.searchParams.get('scope') ?? '').split(/\s+/).filter(Boolean);
	const expectedScopes = ['openid', 'email', GOOGLE_DRIVE_FILE_SCOPE];
	if (
		scopes.length !== expectedScopes.length ||
		!expectedScopes.every((scope) => scopes.includes(scope))
	) {
		throw new Error('Drive OAuth requested an unexpected scope set');
	}

	const state = url.searchParams.get('state') ?? '';
	const nonce = url.searchParams.get('nonce') ?? '';
	const codeChallenge = url.searchParams.get('code_challenge') ?? '';
	if (!OPAQUE.test(state) || !OPAQUE.test(nonce) || !PKCE_CHALLENGE.test(codeChallenge)) {
		throw new Error('Drive OAuth state, nonce, or PKCE challenge is malformed');
	}

	const expected = {
		response_type: 'code',
		access_type: 'offline',
		prompt: 'consent',
		include_granted_scopes: 'false',
		code_challenge_method: 'S256'
	};
	for (const [name, expectedValue] of Object.entries(expected)) {
		if (url.searchParams.get(name) !== expectedValue) {
			throw new Error(`Drive OAuth authorization parameter ${name} is invalid`);
		}
	}
	if (url.searchParams.has('code_verifier')) {
		throw new Error('Drive OAuth authorization URL exposed the PKCE verifier');
	}
}

async function readJson(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

async function main() {
	const supabaseUrl = requireEnv('STAGING_SUPABASE_URL');
	const publishableKey = requireEnv('STAGING_SUPABASE_PUBLISHABLE_KEY');
	const email = requireEnv('STAGING_AUTHORIZED_EMAIL');
	const password = requireEnv('STAGING_AUTHORIZED_PASSWORD');
	const appOrigin = requireEnv('STAGING_APP_ORIGIN');
	const functionUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/drive-oauth-start`;

	const preflight = await fetch(functionUrl, {
		method: 'OPTIONS',
		headers: {
			Origin: appOrigin,
			'Access-Control-Request-Method': 'POST',
			'Access-Control-Request-Headers': 'authorization,apikey,content-type'
		},
		signal: AbortSignal.timeout(15_000)
	});
	if (preflight.status !== 204) {
		const body = await readJson(preflight);
		const code = body && typeof body.code === 'string' ? body.code : 'unknown';
		throw new Error(`Drive OAuth preflight failed with HTTP ${preflight.status} (${code})`);
	}
	assertCors(preflight, appOrigin, 'Drive OAuth preflight');

	const client = createStagingClient(supabaseUrl, publishableKey);
	let signedIn = false;
	try {
		const { data, error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Drive OAuth staging sign-in failed: ${error.message}`);
		if (!data.session?.access_token)
			throw new Error('Drive OAuth staging sign-in returned no session');
		signedIn = true;

		const response = await fetch(functionUrl, {
			method: 'POST',
			headers: {
				Origin: appOrigin,
				Authorization: `Bearer ${data.session.access_token}`,
				apikey: publishableKey,
				'Content-Type': 'application/json'
			},
			body: '{}',
			signal: AbortSignal.timeout(15_000)
		});
		assertCors(response, appOrigin, 'Drive OAuth start');
		const body = await readJson(response);
		if (!response.ok) {
			const code = body && typeof body.code === 'string' ? body.code : 'unknown';
			throw new Error(`Drive OAuth start failed with HTTP ${response.status} (${code})`);
		}

		assertAuthorizationUrl(body?.authorizationUrl, supabaseUrl);
		console.log('Google Drive OAuth staging bootstrap: PASS');
	} finally {
		if (signedIn) {
			const { error } = await client.auth.signOut();
			if (error) throw new Error(`Drive OAuth staging sign-out failed: ${error.message}`);
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
