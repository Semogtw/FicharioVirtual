#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
	assertAuthorizedAccount,
	assertDeniedStorageOperation,
	assertProbeBytes,
	assertProbeIsolation,
	resolveStagingFailure,
	assertSignedStorageUrl,
	assertStorageListIsolation,
	assertSuccessfulSignOut,
	runStagingCleanup,
	assertUnauthorizedAccount
} from './supabase-staging-contract.mjs';

const STORAGE_BUCKET = 'documents';
const STORAGE_PROBE_BYTES = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64'
	)
);

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

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} ownerUserId
 */
async function createStorageProbe(client, ownerUserId) {
	const folder = `${ownerUserId}/__staging_probe_${randomUUID()}`;
	const fileName = 'probe.png';
	const objectPath = `${folder}/${fileName}`;
	const result = await client.storage.from(STORAGE_BUCKET).upload(objectPath, STORAGE_PROBE_BYTES, {
		cacheControl: '0',
		contentType: 'image/png',
		upsert: false
	});
	if (result.error) throw new Error(`Storage probe upload failed: ${result.error.message}`);
	if (result.data?.path !== objectPath) {
		throw new Error(
			`Storage probe upload returned an unexpected path: ${result.data?.path ?? '(missing)'}`
		);
	}
	return { folder, fileName, objectPath };
}

/**
 * @param {unknown} error
 */
function isExpectedStorageDenial(error) {
	if (!error || typeof error !== 'object') return false;
	const candidate = /** @type {{ status?: unknown; statusCode?: unknown }} */ (error);
	const status = Number(candidate.status ?? candidate.statusCode);
	return [400, 401, 403, 404].includes(status);
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} folder
 * @param {string} label
 * @param {boolean} allowDenied
 */
async function listStorageFolder(client, folder, label, allowDenied = false) {
	const result = await client.storage.from(STORAGE_BUCKET).list(folder, {
		limit: 10,
		sortBy: { column: 'name', order: 'asc' }
	});
	if (result.error) {
		if (allowDenied && isExpectedStorageDenial(result.error)) return [];
		throw new Error(`${label} Storage listing failed: ${result.error.message}`);
	}
	return result.data ?? [];
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} objectPath
 * @param {string} label
 */
async function downloadStorageProbe(client, objectPath, label) {
	const result = await client.storage.from(STORAGE_BUCKET).download(objectPath);
	if (result.error) throw new Error(`${label} Storage download failed: ${result.error.message}`);
	if (!result.data) throw new Error(`${label} Storage download returned no data`);
	return new Uint8Array(await result.data.arrayBuffer());
}

/**
 * @param {string} signedUrl
 */
async function downloadSignedProbe(signedUrl) {
	let response;
	try {
		response = await fetch(signedUrl, { signal: AbortSignal.timeout(15_000) });
	} catch (error) {
		throw new Error(
			`signed Storage URL request failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	if (!response.ok) throw new Error(`signed Storage URL returned HTTP ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} objectPath
 */
async function deleteStorageProbe(client, objectPath) {
	const result = await client.storage.from(STORAGE_BUCKET).remove([objectPath]);
	if (result.error) throw new Error(`Storage probe cleanup failed: ${result.error.message}`);
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} label
 */
async function signOutClient(client, label) {
	const result = await client.auth.signOut();
	assertSuccessfulSignOut({ label, error: result.error });
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
	let storageObjectPath = null;

	let operationError = null;
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

		const storageProbe = await createStorageProbe(authorizedClient, authorizedUser.id);
		storageObjectPath = storageProbe.objectPath;
		const [ownerStorageRows, outsiderStorageRows] = await Promise.all([
			listStorageFolder(authorizedClient, storageProbe.folder, 'authorized account'),
			listStorageFolder(unauthorizedClient, storageProbe.folder, 'second account', true)
		]);
		assertStorageListIsolation({
			fileName: storageProbe.fileName,
			ownerRows: ownerStorageRows,
			outsiderRows: outsiderStorageRows
		});
		console.log('PASS private Storage listing is isolated by user prefix and allowlist');

		const ownerDownload = await downloadStorageProbe(
			authorizedClient,
			storageProbe.objectPath,
			'authorized account'
		);
		assertProbeBytes({ expected: STORAGE_PROBE_BYTES, actual: ownerDownload });
		console.log('PASS authorized account downloads the exact Storage probe bytes');

		const outsiderDownload = await unauthorizedClient.storage
			.from(STORAGE_BUCKET)
			.download(storageProbe.objectPath);
		assertDeniedStorageOperation({
			label: 'Storage download',
			data: outsiderDownload.data,
			error: outsiderDownload.error
		});
		console.log('PASS second account cannot download the authorized Storage probe');

		const ownerSigned = await authorizedClient.storage
			.from(STORAGE_BUCKET)
			.createSignedUrl(storageProbe.objectPath, 60);
		if (ownerSigned.error) {
			throw new Error(`authorized signed URL creation failed: ${ownerSigned.error.message}`);
		}
		assertSignedStorageUrl({
			signedUrl: ownerSigned.data?.signedUrl,
			supabaseUrl: url,
			objectPath: storageProbe.objectPath
		});
		const signedDownload = await downloadSignedProbe(ownerSigned.data.signedUrl);
		assertProbeBytes({ expected: STORAGE_PROBE_BYTES, actual: signedDownload });
		console.log('PASS authorized signed URL returns the exact private Storage bytes');

		const outsiderSigned = await unauthorizedClient.storage
			.from(STORAGE_BUCKET)
			.createSignedUrl(storageProbe.objectPath, 60);
		assertDeniedStorageOperation({
			label: 'signed URL creation',
			data: outsiderSigned.data,
			error: outsiderSigned.error
		});
		console.log('PASS second account cannot sign the authorized Storage object');

		console.log('Supabase staging contract: PASS');
	} catch (error) {
		operationError = error;
	}

	const dataCleanup = [];
	if (storageObjectPath) {
		dataCleanup.push(() => deleteStorageProbe(authorizedClient, storageObjectPath));
	}
	if (probeId) dataCleanup.push(() => deleteProbeNotebook(authorizedClient, probeId));
	const cleanupResults = await runStagingCleanup({
		dataCleanup,
		sessionCleanup: [
			() => signOutClient(authorizedClient, 'authorized account'),
			() => signOutClient(unauthorizedClient, 'second account')
		]
	});
	const stagingFailure = resolveStagingFailure({ operationError, cleanupResults });
	if (stagingFailure) throw stagingFailure;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
