#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
	assertAuthorizedAccount,
	assertProbeIsolation,
	assertUnauthorizedAccount
} from './supabase-staging-contract.mjs';

/**
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

/**
 * @param {string} url
 * @param {string} publishableKey
 */
function createStagingClient(url, publishableKey) {
	return createClient(url, publishableKey, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false
		}
	});
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} email
 * @param {string} password
 * @param {string} label
 */
async function signIn(client, email, password, label) {
	const { data, error } = await client.auth.signInWithPassword({ email, password });
	if (error) throw new Error(`${label} sign-in failed: ${error.message}`);
	if (!data.user || !data.session) throw new Error(`${label} sign-in returned no active session`);
	return data.user;
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} userId
 */
async function readAuthorization(client, userId) {
	const authorization = await client.rpc('is_authorized_user');
	if (authorization.error) {
		throw new Error(`is_authorized_user failed: ${authorization.error.message}`);
	}
	if (typeof authorization.data !== 'boolean') {
		throw new Error('is_authorized_user returned a non-boolean value');
	}

	const appUser = await client
		.from('app_users')
		.select('user_id,is_active')
		.eq('user_id', userId)
		.maybeSingle();
	if (appUser.error) throw new Error(`app_users probe failed: ${appUser.error.message}`);

	return { authorized: authorization.data, appUser: appUser.data };
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} ownerUserId
 */
async function createProbeNotebook(client, ownerUserId) {
	const result = await client
		.from('notebooks')
		.insert({
			user_id: ownerUserId,
			name: `__staging_probe_${randomUUID()}`,
			description: 'Temporary RLS probe created by the staging verification workflow.',
			cover_style: 'linen'
		})
		.select('id,user_id')
		.single();
	if (result.error) throw new Error(`probe notebook creation failed: ${result.error.message}`);
	if (!result.data?.id) throw new Error('probe notebook creation returned no id');
	return result.data;
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} probeId
 */
async function readProbeNotebook(client, probeId) {
	const result = await client.from('notebooks').select('id,user_id').eq('id', probeId);
	if (result.error) throw new Error(`probe notebook read failed: ${result.error.message}`);
	return result.data ?? [];
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} probeId
 */
async function deleteProbeNotebook(client, probeId) {
	const result = await client.from('notebooks').delete().eq('id', probeId);
	if (result.error) throw new Error(`probe notebook cleanup failed: ${result.error.message}`);
}

async function main() {
	const url = requireEnv('STAGING_SUPABASE_URL');
	const publishableKey = requireEnv('STAGING_SUPABASE_PUBLISHABLE_KEY');
	const authorizedEmail = requireEnv('STAGING_AUTHORIZED_EMAIL');
	const authorizedPassword = requireEnv('STAGING_AUTHORIZED_PASSWORD');
	const unauthorizedEmail = requireEnv('STAGING_UNAUTHORIZED_EMAIL');
	const unauthorizedPassword = requireEnv('STAGING_UNAUTHORIZED_PASSWORD');

	const authorizedClient = createStagingClient(url, publishableKey);
	const unauthorizedClient = createStagingClient(url, publishableKey);
	let probeId = null;

	try {
		const authorizedUser = await signIn(
			authorizedClient,
			authorizedEmail,
			authorizedPassword,
			'authorized account'
		);
		const unauthorizedUser = await signIn(
			unauthorizedClient,
			unauthorizedEmail,
			unauthorizedPassword,
			'second account'
		);
		if (authorizedUser.id === unauthorizedUser.id) {
			throw new Error('staging verification requires two distinct Auth accounts');
		}

		const authorizedState = await readAuthorization(authorizedClient, authorizedUser.id);
		assertAuthorizedAccount({ userId: authorizedUser.id, ...authorizedState });
		console.log('PASS authorized account is active in the allowlist');

		const unauthorizedState = await readAuthorization(unauthorizedClient, unauthorizedUser.id);
		assertUnauthorizedAccount({ userId: unauthorizedUser.id, ...unauthorizedState });
		console.log('PASS second account remains outside the active allowlist');

		const probe = await createProbeNotebook(authorizedClient, authorizedUser.id);
		probeId = probe.id;
		const [ownerRows, outsiderRows] = await Promise.all([
			readProbeNotebook(authorizedClient, probeId),
			readProbeNotebook(unauthorizedClient, probeId)
		]);
		assertProbeIsolation({
			probeId,
			ownerUserId: authorizedUser.id,
			ownerRows,
			outsiderRows
		});
		console.log('PASS notebook RLS hides the authorized probe from the second account');

		console.log('Supabase staging contract: PASS');
	} finally {
		if (probeId) await deleteProbeNotebook(authorizedClient, probeId);
		await Promise.allSettled([authorizedClient.auth.signOut(), unauthorizedClient.auth.signOut()]);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
