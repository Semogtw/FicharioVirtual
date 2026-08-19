#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import {
	assertOcrInvocation,
	assertOcrPersistence,
	createOcrInvocationDiagnostic,
	createOcrProbePng,
	createOcrStagingReport,
	formatOcrInvocationFailure,
	normalizeOcrProbeText
} from './ocr-staging-contract.mjs';
import {
	assertSuccessfulSignOut,
	resolveStagingFailure,
	runStagingCleanup
} from './supabase-staging-contract.mjs';

const STORAGE_BUCKET = 'documents';
const OCR_RETRY_DELAYS_MS = Object.freeze([0, 5_000, 20_000, 60_000]);

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

/** @param {unknown} data @param {string} pageId */
function isRetryLater(data, pageId) {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
	const record = /** @type {Record<string, unknown>} */ (data);
	return (
		record.state === 'partial' &&
		Array.isArray(record.pendingPageIds) &&
		record.pendingPageIds.length === 1 &&
		record.pendingPageIds[0] === pageId &&
		Array.isArray(record.failedPageIds) &&
		record.failedPageIds.length === 0
	);
}

/** @param {number} milliseconds */
function wait(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Mirrors the browser OCR queue's finite retry rounds. A partial response with
 * this probe still pending is never considered success: the probe must reach a
 * terminal aggregate response in the bounded 0/5s/20s/60s recovery window.
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} pageId
 */
async function invokeProbeOcr(client, pageId) {
	let invocation = null;
	for (const [round, delayMs] of OCR_RETRY_DELAYS_MS.entries()) {
		if (delayMs > 0) await wait(delayMs);
		invocation = await client.functions.invoke('process-ocr', { body: { pageIds: [pageId] } });
		if (invocation.error || !isRetryLater(invocation.data, pageId)) return invocation;
		if (round < OCR_RETRY_DELAYS_MS.length - 1) {
			console.log(`INFO process-ocr requested bounded retry round ${round + 1}`);
		}
	}
	return invocation;
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
	const imagePath = `${userId}/staging-probes/${documentId}.png`;
	const bucket = client.storage.from(STORAGE_BUCKET);
	const upload = await bucket.upload(imagePath, bytes, {
		cacheControl: '0',
		contentType: 'image/png',
		upsert: false
	});
	if (upload.error) {
		throw new Error(`OCR probe upload failed: ${upload.error.message}`);
	}

	const metadata = await client.rpc('create_ocr_staging_probe', {
		target_document_id: documentId,
		target_page_id: pageId,
		target_job_id: jobId,
		image_storage_path: imagePath,
		prepared_sha256: sha256,
		prompt_version: 1
	});
	const row = Array.isArray(metadata.data) ? metadata.data[0] : null;
	if (
		metadata.error ||
		row?.document_id !== documentId ||
		row?.page_id !== pageId ||
		row?.ocr_job_id !== jobId
	) {
		await bucket.remove([imagePath]);
		throw new Error(
			`OCR probe metadata failed: ${metadata.error?.message ?? 'unexpected response'}`
		);
	}

	return { documentId, pageId, jobId, imagePath };
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
 * Read only the allowlisted provider metadata while the probe still exists.
 * The document cleanup cascades telemetry, so this must happen before deletion.
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {{ documentId: string }} probe
 */
async function readProbeProviderAttempts(client, probe) {
	const [events, metrics] = await Promise.all([
		client
			.from('ocr_provider_usage_events')
			.select('id,model,status,safe_error_code')
			.eq('document_id', probe.documentId)
			.order('created_at', { ascending: true }),
		client
			.from('ocr_provider_page_metrics')
			.select('usage_event_id,route_reason')
			.eq('document_id', probe.documentId)
	]);
	if (events.error)
		throw new Error(`OCR provider telemetry verification failed: ${events.error.message}`);
	if (metrics.error)
		throw new Error(`OCR provider route verification failed: ${metrics.error.message}`);
	const routeByEvent = new Map(
		(metrics.data ?? []).map((metric) => [metric.usage_event_id, metric.route_reason])
	);
	return (events.data ?? []).map((event) => ({
		model: event.model,
		status: event.status,
		safeErrorCode: event.safe_error_code,
		routeReason: routeByEvent.get(event.id) ?? null
	}));
}

/**
 * @param {ReturnType<typeof createStagingClient>} client
 * @param {string} documentId
 */
async function deleteProbeDocument(client, documentId) {
	const result = await client.functions.invoke('delete-document', { body: { documentId } });
	if (result.error) throw new Error(`OCR probe cleanup failed: ${result.error.message}`);
}

/** @param {ReturnType<typeof createStagingClient>} client */
async function signOut(client) {
	const result = await client.auth.signOut({ scope: 'local' });
	assertSuccessfulSignOut({ label: 'OCR staging account', error: result.error });
}

async function main() {
	const reportPath = process.env.OCR_STAGING_REPORT_PATH?.trim() || null;
	const stages = {
		authenticated: false,
		authorized: false,
		probeCreated: false,
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
	let diagnostic = {
		httpStatus: null,
		errorKind: null,
		providerStatus: null,
		providerErrorKind: null,
		providerErrorCode: null,
		runtimeErrorCode: null
	};
	let providerAttempts = [];
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

		currentStage = 'probe';
		probe = await createProbeImport(client, user.id);
		stages.probeCreated = true;
		console.log('PASS synthetic OCR probe was created with public credentials');

		currentStage = 'invocation';
		const invocation = await invokeProbeOcr(client, probe.pageId);
		if (invocation?.error) {
			diagnostic = await createOcrInvocationDiagnostic({
				error: invocation.error,
				response: invocation.response
			});
			throw new Error(formatOcrInvocationFailure(diagnostic));
		}
		const invocationResult = assertOcrInvocation({ data: invocation?.data, pageId: probe.pageId });
		stages.functionCompleted = true;
		outcome.needsReview = invocationResult.needsReview;
		console.log('PASS process-ocr completed the synthetic image through the launch batch contract');

		currentStage = 'persistence';
		const persisted = await readProbePersistence(client, probe);
		assertOcrPersistence(persisted);
		stages.persistenceVerified = true;
		outcome.documentStatus = persisted.document.status;
		outcome.pageStatus = persisted.page.status;
		outcome.jobStatus = persisted.job.status;
		outcome.warningCount = Array.isArray(persisted.page.warnings)
			? persisted.page.warnings.length
			: null;
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

	if (client && probe) {
		try {
			const runtimeState = await readProbePersistence(client, probe);
			diagnostic.runtimeErrorCode = runtimeState.job?.last_error_code ?? null;
		} catch {
			// Runtime state is best-effort diagnostics and must not hide the original failure.
		}
		try {
			providerAttempts = await readProbeProviderAttempts(client, probe);
		} catch {
			// Provider routing is best-effort diagnostics and must not hide the original failure.
		}
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
		providerAttempts,
		diagnostic,
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
