#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import {
	assertOcrInvocation,
	assertOcrPersistence,
	createOcrProbePng,
	createOcrStagingReport,
	normalizeOcrProbeText
} from './ocr-staging-contract.mjs';
import {
	assertSuccessfulSignOut,
	resolveStagingFailure,
	runStagingCleanup
} from './supabase-staging-contract.mjs';

const STORAGE_BUCKET = 'documents';

/** @param {string} name */
function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

/** @param {string} url @param {string} publishableKey */
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
 */
async function signIn(client, email, password) {
	const result = await client.auth.signInWithPassword({ email, password });
	if (result.error) throw new Error(`OCR staging sign-in failed: ${result.error.message}`);
	if (!result.data.user || !result.data.session) {
		throw new Error('OCR staging sign-in returned no active session');
	}
	return result.data.user;
}

/** @param {ReturnType<typeof createStagingClient>} client */
async function recordConsent(client) {
	const result = await client.rpc('record_ocr_consent', { consent_version: 1 });
	if (result.error || result.data !== true) {
		throw new Error(`OCR consent failed: ${result.error?.message ?? 'unexpected response'}`);
	}
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} userId
 */
async function createProbeImport(client, userId) {
	const documentId = randomUUID();
	const pageId = randomUUID();
	const jobId = randomUUID();
	const nonce = `probe-${randomUUID()}`;
	const bytes = createOcrProbePng(nonce);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const root = `${userId}/${documentId}`;
	const originalPath = `${root}/ocr-staging-original.png`;
	const thumbnailPath = `${root}/ocr-staging-thumbnail.png`;
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
	if (original.error || thumbnail.error) {
		await bucket.remove([originalPath, thumbnailPath]);
		throw new Error(
			`OCR probe upload failed: ${original.error?.message ?? thumbnail.error?.message ?? 'unknown error'}`
		);
	}

	const metadata = await client.rpc('create_image_import', {
		target_document_id: documentId,
		target_page_id: pageId,
		target_job_id: jobId,
		target_notebook_id: null,
		document_title: '__staging_ocr_probe__',
		original_filename: 'ocr-staging-probe.png',
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
		await bucket.remove([originalPath, thumbnailPath]);
		throw new Error(
			`OCR probe metadata failed: ${metadata.error?.message ?? 'unexpected response'}`
		);
	}

	return { documentId, pageId, jobId, originalPath, thumbnailPath };
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {{ documentId: string; pageId: string; jobId: string }} probe
 */
async function readProbePersistence(client, probe) {
	const [document, page, job] = await Promise.all([
		client.from('documents').select('id,status').eq('id', probe.documentId).maybeSingle(),
		client
			.from('pages')
			.select('id,status,extraction_source,ocr_raw_text,warnings')
			.eq('id', probe.pageId)
			.maybeSingle(),
		client
			.from('ocr_jobs')
			.select('id,status,attempt_count,last_error_code,finished_at')
			.eq('id', probe.jobId)
			.maybeSingle()
	]);
	for (const [label, result] of [
		['document', document],
		['page', page],
		['job', job]
	]) {
		if (result.error) throw new Error(`OCR ${label} verification failed: ${result.error.message}`);
	}
	return { document: document.data, page: page.data, job: job.data };
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} documentId
 */
async function deleteProbeDocument(client, documentId) {
	const result = await client.functions.invoke('delete-document', { body: { documentId } });
	if (result.error) throw new Error(`OCR probe cleanup failed: ${result.error.message}`);
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 */
async function signOut(client) {
	const result = await client.auth.signOut();
	assertSuccessfulSignOut({ label: 'OCR staging account', error: result.error });
}

async function main() {
	const reportPath = process.env.OCR_STAGING_REPORT_PATH?.trim() || null;
	const stages = {
		authenticated: false,
		authorized: false,
		consentRecorded: false,
		importCreated: false,
		functionCompleted: false,
		persistenceVerified: false
	};
	const outcome = {
		documentStatus: null,
		pageStatus: null,
		jobStatus: null,
		needsReview: null,
		warningCount: null,
		attemptCount: null,
		tokens: { fichario: null, ocr: null, numericProbe: null }
	};
	let client = null;
	let probe = null;
	let operationError = null;
	let failureStage = null;
	let currentStage = 'configuration';

	try {
		const url = requireEnv('STAGING_SUPABASE_URL');
		const publishableKey = requireEnv('STAGING_SUPABASE_PUBLISHABLE_KEY');
		const email = requireEnv('STAGING_AUTHORIZED_EMAIL');
		const password = requireEnv('STAGING_AUTHORIZED_PASSWORD');
		client = createStagingClient(url, publishableKey);

		currentStage = 'authentication';
		const user = await signIn(client, email, password);
		stages.authenticated = true;

		currentStage = 'authorization';
		const authorization = await client.rpc('is_authorized_user');
		if (authorization.error || authorization.data !== true) {
			throw new Error('OCR staging account is not active in the allowlist');
		}
		stages.authorized = true;

		currentStage = 'consent';
		await recordConsent(client);
		stages.consentRecorded = true;

		currentStage = 'import';
		probe = await createProbeImport(client, user.id);
		stages.importCreated = true;
		console.log('PASS synthetic OCR document was created with public credentials');

		currentStage = 'invocation';
		const invocation = await client.functions.invoke('process-ocr', {
			body: { pageId: probe.pageId }
		});
		if (invocation.error) throw new Error(`process-ocr failed: ${invocation.error.message}`);
		assertOcrInvocation({ data: invocation.data });
		stages.functionCompleted = true;
		outcome.needsReview = invocation.data.needsReview;
		outcome.warningCount = invocation.data.warningCount;
		console.log('PASS process-ocr completed the synthetic image');

		currentStage = 'persistence';
		const persisted = await readProbePersistence(client, probe);
		assertOcrPersistence(persisted);
		stages.persistenceVerified = true;
		outcome.documentStatus = persisted.document.status;
		outcome.pageStatus = persisted.page.status;
		outcome.jobStatus = persisted.job.status;
		outcome.attemptCount = persisted.job.attempt_count;
		const transcriptTokens = normalizeOcrProbeText(persisted.page.ocr_raw_text).split(' ');
		outcome.tokens = {
			fichario: transcriptTokens.includes('fichario'),
			ocr: transcriptTokens.includes('ocr'),
			numericProbe: transcriptTokens.includes('2718')
		};
		console.log('PASS OCR transcript and terminal database state match the synthetic probe');
		currentStage = null;
	} catch (error) {
		operationError = error;
		failureStage = currentStage;
	}

	let documentCleanup = probe ? 'failure' : 'not_required';
	let sessionCleanup = client ? 'failure' : 'not_required';
	const cleanupResults = await runStagingCleanup({
		dataCleanup:
			client && probe
				? [
						async () => {
							await deleteProbeDocument(client, probe.documentId);
							documentCleanup = 'success';
						}
					]
				: [],
		sessionCleanup: client
			? [
					async () => {
						await signOut(client);
						sessionCleanup = 'success';
					}
				]
			: []
	});
	const failure = resolveStagingFailure({ operationError, cleanupResults });
	if (failure && operationError == null) failureStage = 'cleanup';

	const report = createOcrStagingReport({
		status: failure ? 'fail' : 'pass',
		failureStage,
		stages,
		outcome,
		cleanup: { document: documentCleanup, session: sessionCleanup }
	});
	let reportError = null;
	if (reportPath) {
		try {
			await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
		} catch (error) {
			reportError = error instanceof Error ? error : new Error(String(error));
		}
	}

	if (failure && reportError) {
		throw new AggregateError([failure, reportError], 'OCR staging verification and report failed');
	}
	if (failure) throw failure;
	if (reportError) throw reportError;
	console.log('OCR staging contract: PASS');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
