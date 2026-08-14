#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_CLIENT_ID = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const OPAQUE = /^[A-Za-z0-9_-]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const PREFLIGHT_HEADERS = 'authorization,apikey,content-type,x-client-info,x-supabase-api-version';

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
	const allowedHeaders = new Set(
		(response.headers.get('access-control-allow-headers') ?? '')
			.split(',')
			.map((header) => header.trim().toLowerCase())
			.filter(Boolean)
	);
	for (const header of PREFLIGHT_HEADERS.split(',')) {
		if (!allowedHeaders.has(header)) {
			throw new Error(`${label} CORS is missing allowed header ${header}`);
		}
	}
}

function assertNoCors(response, label) {
	const allowedOrigin = response.headers.get('access-control-allow-origin');
	if (allowedOrigin !== null) {
		throw new Error(`${label} unexpectedly allowed origin ${allowedOrigin}`);
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
	if (state.length <= 43) {
		throw new Error('Drive OAuth state did not bind the initiating application origin');
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

async function preflight(functionUrl, origin) {
	return fetch(functionUrl, {
		method: 'OPTIONS',
		headers: {
			Origin: origin,
			'Access-Control-Request-Method': 'POST',
			'Access-Control-Request-Headers': PREFLIGHT_HEADERS
		},
		signal: AbortSignal.timeout(15_000)
	});
}

async function main() {
	const supabaseUrl = requireEnv('STAGING_SUPABASE_URL');
	const publishableKey = requireEnv('STAGING_SUPABASE_PUBLISHABLE_KEY');
	const email = requireEnv('STAGING_AUTHORIZED_EMAIL');
	const password = requireEnv('STAGING_AUTHORIZED_PASSWORD');
	const canonicalOrigin = requireEnv('STAGING_APP_ORIGIN');
	const configuredAllowlist = requireEnv('STAGING_APP_ORIGIN_ALLOWLIST');
	const rootOrigin = 'https://fichario-virtual.pages.dev';
	const immutableProbeOrigin = 'https://deadbeef.fichario-virtual.pages.dev';
	const rejectedOrigin = 'https://fichario-virtual.pages.dev.evil.test';
	const functionUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/drive-oauth-start`;

	for (const expected of [canonicalOrigin, rootOrigin, 'https://*.fichario-virtual.pages.dev']) {
		if (!configuredAllowlist.split(',').includes(expected)) {
			throw new Error(`Staging origin allowlist is missing ${expected}`);
		}
	}

	for (const origin of [canonicalOrigin, rootOrigin, immutableProbeOrigin]) {
		const response = await preflight(functionUrl, origin);
		if (response.status !== 204) {
			const body = await readJson(response);
			const code = body && typeof body.code === 'string' ? body.code : 'unknown';
			throw new Error(
				`Drive OAuth preflight for ${origin} failed with HTTP ${response.status} (${code})`
			);
		}
		assertCors(response, origin, `Drive OAuth preflight for ${origin}`);
	}

	const rejected = await preflight(functionUrl, rejectedOrigin);
	assertNoCors(rejected, 'Drive OAuth rejected-origin preflight');

	const client = createStagingClient(supabaseUrl, publishableKey);
	let signedIn = false;
	let operationError = null;
	try {
		const { data, error } = await client.auth.signInWithPassword({ email, password });
		if (error) throw new Error(`Drive OAuth staging sign-in failed: ${error.message}`);
		if (!data.session?.access_token)
			throw new Error('Drive OAuth staging sign-in returned no session');
		signedIn = true;

		const response = await fetch(functionUrl, {
			method: 'POST',
			headers: {
				Origin: rootOrigin,
				Authorization: `Bearer ${data.session.access_token}`,
				apikey: publishableKey,
				'Content-Type': 'application/json',
				'x-client-info': 'fichario-staging-cors-probe',
				'x-supabase-api-version': '2024-01-01'
			},
			body: '{}',
			signal: AbortSignal.timeout(15_000)
		});
		assertCors(response, rootOrigin, 'Drive OAuth start from root Pages alias');
		const body = await readJson(response);
		if (!response.ok) {
			const code = body && typeof body.code === 'string' ? body.code : 'unknown';
			throw new Error(`Drive OAuth start failed with HTTP ${response.status} (${code})`);
		}

		assertAuthorizationUrl(body?.authorizationUrl, supabaseUrl);
		console.log('Google Drive OAuth staging browser-origin bootstrap: PASS');
	} catch (error) {
		operationError = error;
	}

	if (signedIn) {
		const { error } = await client.auth.signOut({ scope: 'local' });
		if (error && operationError === null) {
			operationError = new Error(`Drive OAuth staging sign-out failed: ${error.message}`);
		}
	}
	if (operationError) throw operationError;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
