#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAIRING_CODE = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

function stagingClient(url, publishableKey) {
	return createClient(url, publishableKey, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false
		}
	});
}

function assertPairing(value) {
	if (
		value === null ||
		typeof value !== 'object' ||
		typeof value.pairingId !== 'string' ||
		!UUID.test(value.pairingId) ||
		typeof value.code !== 'string' ||
		!PAIRING_CODE.test(value.code) ||
		typeof value.expiresAt !== 'string' ||
		!Number.isFinite(Date.parse(value.expiresAt))
	) {
		throw new Error('Pairing-code RPC returned an invalid receipt');
	}
	return value;
}

async function redeemWithoutJwt(url, publishableKey, body) {
	const endpoint = new URL('/functions/v1/desktop-ocr-pair', url);
	return fetch(endpoint, {
		method: 'POST',
		headers: {
			apikey: publishableKey,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});
}

async function responseJson(response, label) {
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error(`${label} returned non-JSON HTTP ${response.status}`);
	}
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		throw new Error(`${label} returned an invalid JSON object`);
	}
	return body;
}

async function main() {
	const url = requireEnv('STAGING_SUPABASE_URL');
	const publishableKey = requireEnv('STAGING_SUPABASE_PUBLISHABLE_KEY');
	const email = requireEnv('STAGING_AUTHORIZED_EMAIL');
	const password = requireEnv('STAGING_AUTHORIZED_PASSWORD');
	const client = stagingClient(url, publishableKey);
	let deviceId = null;
	let revoked = false;
	let deleted = false;
	let operationError = null;

	try {
		const signIn = await client.auth.signInWithPassword({ email, password });
		if (signIn.error || !signIn.data.user || !signIn.data.session) {
			throw new Error(`Desktop OCR staging sign-in failed: ${signIn.error?.message ?? 'no session'}`);
		}

		const created = await client.rpc('create_ocr_worker_pairing_code');
		if (created.error) throw new Error(`Pairing-code creation failed: ${created.error.message}`);
		const pairing = assertPairing(created.data);

		const credential = randomBytes(32);
		const credentialDigest = createHash('sha256').update(credential).digest('hex');
		credential.fill(0);
		const label = `__staging_pair_probe__-${randomUUID().slice(0, 8)}`;
		const capabilities = {
			protocolVersion: 1,
			backend: 'ollama',
			model: 'staging-probe',
			maxConcurrency: 1
		};
		const redeemBody = {
			action: 'redeem',
			pairingCode: pairing.code,
			label,
			capabilities,
			credentialDigest
		};

		const redeemedResponse = await redeemWithoutJwt(url, publishableKey, redeemBody);
		const redeemed = await responseJson(redeemedResponse, 'Pairing redemption');
		if (
			redeemedResponse.status !== 201 ||
			typeof redeemed.deviceId !== 'string' ||
			!UUID.test(redeemed.deviceId) ||
			redeemed.label !== label ||
			redeemed.status !== 'active' ||
			'credential' in redeemed
		) {
			throw new Error(`Pairing redemption returned an invalid HTTP ${redeemedResponse.status} receipt`);
		}
		deviceId = redeemed.deviceId;
		console.log('PASS one-time pairing code redeemed without a browser JWT or returned credential');

		const replayResponse = await redeemWithoutJwt(url, publishableKey, redeemBody);
		const replay = await responseJson(replayResponse, 'Pairing replay');
		if (replayResponse.status !== 409 || replay.code !== 'desktop_ocr_pairing_code_unavailable') {
			throw new Error(`Pairing replay was not rejected as one-time HTTP ${replayResponse.status}`);
		}
		console.log('PASS consumed pairing code replay was rejected');

		const listed = await client.rpc('list_ocr_worker_devices');
		if (listed.error || !Array.isArray(listed.data)) {
			throw new Error(`Device listing failed: ${listed.error?.message ?? 'invalid response'}`);
		}
		const device = listed.data.find((entry) => entry?.device_id === deviceId);
		if (!device || device.label !== label || device.status !== 'active') {
			throw new Error('Redeemed staging device is missing from the owner-scoped device list');
		}
		console.log('PASS paired device is visible only through the authenticated owner list contract');

		const revocation = await client.rpc('revoke_ocr_worker_device', { target_device_id: deviceId });
		if (
			revocation.error ||
			revocation.data?.deviceId !== deviceId ||
			revocation.data?.status !== 'revoked'
		) {
			throw new Error(`Device revocation failed: ${revocation.error?.message ?? 'invalid receipt'}`);
		}
		revoked = true;

		const deletion = await client.rpc('delete_ocr_worker_device', { target_device_id: deviceId });
		if (
			deletion.error ||
			deletion.data?.deviceId !== deviceId ||
			deletion.data?.deleted !== true ||
			!Number.isSafeInteger(deletion.data?.pairingCodesDeleted) ||
			deletion.data.pairingCodesDeleted < 1
		) {
			throw new Error(`Device cleanup failed: ${deletion.error?.message ?? 'invalid receipt'}`);
		}
		deleted = true;
		console.log('PASS staging device was revoked and deleted with its consumed pairing record');
	} catch (error) {
		operationError = error instanceof Error ? error : new Error(String(error));
	}

	const cleanupErrors = [];
	if (deviceId && !deleted) {
		if (!revoked) {
			const result = await client.rpc('revoke_ocr_worker_device', { target_device_id: deviceId });
			if (result.error) cleanupErrors.push(new Error('Failed to revoke staging pairing probe during cleanup'));
			else revoked = true;
		}
		if (revoked) {
			const result = await client.rpc('delete_ocr_worker_device', { target_device_id: deviceId });
			if (result.error) cleanupErrors.push(new Error('Failed to delete staging pairing probe during cleanup'));
		}
	}

	const signOut = await client.auth.signOut();
	if (signOut.error) cleanupErrors.push(new Error('Failed to sign out staging pairing probe'));

	if (operationError && cleanupErrors.length > 0) {
		throw new AggregateError([operationError, ...cleanupErrors], 'Pairing staging probe and cleanup failed');
	}
	if (operationError) throw operationError;
	if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Pairing staging cleanup failed');
	console.log('Desktop OCR pairing staging contract: PASS');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
