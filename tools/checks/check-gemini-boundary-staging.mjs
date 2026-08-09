#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createOcrInvocationDiagnostic } from './ocr-staging-contract.mjs';

const STORAGE_BUCKET = 'documents';
const DIAGNOSTIC_BODY = Object.freeze({ diagnostic: 'gemini-provider-v1' });
const DIAGNOSTIC_FIXTURE_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const DIAGNOSTIC_CODES = new Set([
	'provider_ok',
	'gemini_daily_quota',
	'gemini_rate_limited',
	'gemini_authentication_failed',
	'gemini_model_unavailable',
	'gemini_invalid_request',
	'gemini_service_unavailable',
	'provider_response_invalid',
	'provider_transport_failed',
	'provider_not_configured',
	'configuration_missing',
	'diagnostic_forbidden',
	'diagnostic_bad_request'
]);
const DIAGNOSTIC_CATEGORIES = new Set([
	'provider',
	'transport',
	'configuration',
	'authorization',
	'request'
]);

function configurationMissingReport() {
	return {
		schemaVersion: 1,
		status: 'fail',
		direct: {
			status: 'fail',
			category: 'configuration',
			code: 'configuration_missing',
			httpStatus: null
		},
		process: {
			status: 'not_run',
			category: 'configuration',
			code: 'configuration_missing',
			httpStatus: null,
			errorKind: null,
			providerStatus: null,
			providerErrorKind: null,
			providerErrorCode: null
		},
		cleanup: { document: 'not_required', session: 'not_required' }
	};
}

/** @param {string} name */
function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

/** @param {string[]} names */
function missingEnv(names) {
	return names.filter((name) => !process.env[name]?.trim());
}

/** @param {string} url @param {string} publishableKey */
function createStagingClient(url, publishableKey) {
	return createClient(url, publishableKey, {
		auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
	});
}

/** @param {ReturnType<typeof createStagingClient>} client @param {string} email @param {string} password */
async function signIn(client, email, password) {
	const result = await client.auth.signInWithPassword({ email, password });
	if (result.error || !result.data.user || !result.data.session) {
		throw new Error('Gemini boundary staging sign-in failed');
	}
	return { userId: result.data.user.id, accessToken: result.data.session.access_token };
}

/** @param {ReturnType<typeof createStagingClient>} client */
async function recordConsent(client) {
	const result = await client.rpc('record_ocr_consent', { consent_version: 1 });
	if (result.error || result.data !== true) throw new Error('Gemini boundary consent failed');
}

/** @param {ReturnType<typeof createStagingClient>} client @param {string} userId @param {Uint8Array} bytes */
async function createProbeImport(client, userId, bytes) {
	const documentId = randomUUID();
	const pageId = randomUUID();
	const jobId = randomUUID();
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const root = `${userId}/${documentId}`;
	const originalPath = `${root}/gemini-boundary-original.png`;
	const thumbnailPath = `${root}/gemini-boundary-thumbnail.png`;
	const bucket = client.storage.from(STORAGE_BUCKET);
	const [original, thumbnail] = await Promise.all([
		bucket.upload(originalPath, bytes, {
			cacheControl: '0',
			contentType: 'image/png',
			upsert: false
		}),
		bucket.upload(thumbnailPath, bytes, {
			cacheControl: '0',
			contentType: 'image/png',
			upsert: false
		})
	]);
	if (original.error || thumbnail.error) throw new Error('Gemini boundary upload failed');
	const metadata = await client.rpc('create_image_import', {
		target_document_id: documentId,
		target_page_id: pageId,
		target_job_id: jobId,
		target_notebook_id: null,
		document_title: '__staging_gemini_boundary__',
		original_filename: 'gemini-boundary.png',
		original_storage_path: originalPath,
		thumbnail_storage_path: thumbnailPath,
		prepared_sha256: sha256,
		source_created_at: null,
		prompt_version: 1
	});
	const row = Array.isArray(metadata.data) ? metadata.data[0] : null;
	if (
		metadata.error ||
		row?.document_id !== documentId ||
		row?.page_id !== pageId ||
		row?.ocr_job_id !== jobId
	) {
		throw new Error('Gemini boundary metadata failed');
	}
	return { documentId, pageId, originalPath, thumbnailPath };
}

/** @param {unknown} body @param {number} httpStatus */
function sanitizeDirectResult(body, httpStatus) {
	const record = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
	const status = record.status === 'pass' || record.status === 'fail' ? record.status : 'fail';
	const category = DIAGNOSTIC_CATEGORIES.has(record.category) ? record.category : 'transport';
	const code = DIAGNOSTIC_CODES.has(record.code) ? record.code : 'provider_transport_failed';
	return {
		status,
		category,
		code,
		httpStatus:
			Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null
	};
}

/** @param {string} url @param {string} serviceRoleKey */
async function runDirectProbe(url, serviceRoleKey) {
	let response;
	try {
		response = await fetch(`${url}/functions/v1/process-ocr`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${serviceRoleKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(DIAGNOSTIC_BODY)
		});
	} catch {
		return {
			status: 'fail',
			category: 'transport',
			code: 'provider_transport_failed',
			httpStatus: null
		};
	}
	let body = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	return sanitizeDirectResult(body, response.status);
}

/** @param {ReturnType<typeof createStagingClient>} client @param {string} pageId */
async function runProcessProbe(client, pageId) {
	const invocation = await client.functions.invoke('process-ocr', { body: { pageId } });
	if (invocation.error) {
		const diagnostic = await createOcrInvocationDiagnostic({
			error: invocation.error,
			response: invocation.response
		});
		return {
			status: 'fail',
			category: diagnostic.providerErrorCode ? 'provider' : 'transport',
			code: diagnostic.providerErrorCode ?? 'provider_transport_failed',
			httpStatus: diagnostic.httpStatus,
			errorKind: diagnostic.errorKind,
			providerStatus: diagnostic.providerStatus,
			providerErrorKind: diagnostic.providerErrorKind,
			providerErrorCode: diagnostic.providerErrorCode
		};
	}
	return {
		status: 'pass',
		category: 'provider',
		code: 'provider_ok',
		httpStatus: 200,
		errorKind: null,
		providerStatus: null,
		providerErrorKind: null,
		providerErrorCode: null
	};
}

/** @param {ReturnType<typeof createStagingClient>} client @param {string} documentId */
async function cleanupDocument(client, documentId) {
	const result = await client.functions.invoke('delete-document', { body: { documentId } });
	if (result.error) throw new Error('Gemini boundary document cleanup failed');
}

/** @param {ReturnType<typeof createStagingClient>} client */
async function signOut(client) {
	const result = await client.auth.signOut();
	if (result.error) throw new Error('Gemini boundary sign-out failed');
}

async function main() {
	const reportPath = process.env.GEMINI_BOUNDARY_REPORT_PATH?.trim() || null;
	let report = configurationMissingReport();
	let client = null;
	let probe = null;
	let failure = null;
	try {
		const configuration = [
			'STAGING_SUPABASE_URL',
			'STAGING_SUPABASE_PUBLISHABLE_KEY',
			'STAGING_AUTHORIZED_EMAIL',
			'STAGING_AUTHORIZED_PASSWORD',
			'STAGING_SERVICE_ROLE_KEY'
		];
		if (missingEnv(configuration).length > 0) {
			failure = new Error('Gemini boundary configuration missing');
		} else {
			const url = requireEnv('STAGING_SUPABASE_URL');
			const serviceRoleKey = requireEnv('STAGING_SERVICE_ROLE_KEY');
			const publishableKey = requireEnv('STAGING_SUPABASE_PUBLISHABLE_KEY');
			const email = requireEnv('STAGING_AUTHORIZED_EMAIL');
			const password = requireEnv('STAGING_AUTHORIZED_PASSWORD');
			const bytes = Buffer.from(DIAGNOSTIC_FIXTURE_BASE64, 'base64');
			report.direct = await runDirectProbe(url, serviceRoleKey);
			client = createStagingClient(url, publishableKey);
			const session = await signIn(client, email, password);
			await recordConsent(client);
			probe = await createProbeImport(client, session.userId, bytes);
			report.process = await runProcessProbe(client, probe.pageId);
			report.status =
				report.direct.status === 'pass' && report.process.status === 'pass' ? 'pass' : 'fail';
		}
	} catch (error) {
		failure = error instanceof Error ? error : new Error('Gemini boundary probe failed');
	}
	if (client && probe) {
		try {
			await cleanupDocument(client, probe.documentId);
			report.cleanup.document = 'success';
		} catch {
			report.cleanup.document = 'failure';
			failure ??= new Error('Gemini boundary document cleanup failed');
		}
	}
	if (client) {
		try {
			await signOut(client);
			report.cleanup.session = 'success';
		} catch {
			report.cleanup.session = 'failure';
			failure ??= new Error('Gemini boundary sign-out failed');
		}
	}
	if (reportPath)
		await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
	console.log(JSON.stringify(report));
	if (failure) throw new Error('Gemini boundary staging probe failed');
	if (report.status !== 'pass') throw new Error('Gemini boundary staging probe failed');
}

main().catch(() => {
	console.error('Gemini boundary staging probe failed');
	process.exitCode = 1;
});
