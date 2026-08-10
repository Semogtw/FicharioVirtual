import { rm } from 'node:fs/promises';
import { DesktopWorkerApiError } from './client.mjs';
import { requireCompletionRequest } from './contract.mjs';
import { flushResultSpool } from './delivery.mjs';
import { runWithLeaseRenewal } from './lease.mjs';
import { DesktopSourceError, downloadDesktopSource } from './source.mjs';

const SAFE_CODE = /^[a-z0-9_]{3,96}$/;

function safeCode(error, fallback) {
	if (error instanceof DesktopWorkerApiError || error instanceof DesktopSourceError)
		return error.code;
	if (error?.name === 'TimeoutError') return 'worker_request_timeout';
	if (error?.name === 'AbortError') return 'worker_request_aborted';
	if (typeof error?.code === 'string' && SAFE_CODE.test(error.code)) return error.code;
	return fallback;
}

function requireEngine(engine) {
	if (!engine || typeof engine.process !== 'function') {
		throw new TypeError('Invalid desktop worker OCR engine');
	}
	return engine;
}

function completionFromEngine(lease, source, output) {
	if (!output || typeof output !== 'object' || Array.isArray(output)) {
		throw new TypeError('Invalid desktop worker OCR engine result');
	}
	return requireCompletionRequest({
		action: 'complete',
		jobId: lease.jobId,
		leaseId: lease.leaseId,
		sourceSha256: source.sourceSha256,
		backend: output.backend,
		modelId: output.modelId,
		modelVersion: output.modelVersion,
		rawText: output.rawText,
		correctedText: output.correctedText,
		contentType: output.contentType,
		warnings: output.warnings,
		needsReview: output.needsReview,
		timingMs: output.timingMs,
		wordGeometry: output.wordGeometry ?? []
	});
}

export async function runWorkerCycle(
	{ client, spool, engine, downloadsDir },
	{
		signal,
		now = () => new Date(),
		leaseNow = () => Date.now(),
		keepCompletedSpoolHours = 24,
		downloadSource = downloadDesktopSource,
		renewLease = runWithLeaseRenewal,
		removeFile = (path) => rm(path, { force: true })
	} = {}
) {
	if (
		!client ||
		typeof client.claim !== 'function' ||
		typeof client.source !== 'function' ||
		typeof client.renew !== 'function'
	) {
		throw new TypeError('Invalid desktop worker API client');
	}
	if (!spool || typeof spool.purgeAcceptedBefore !== 'function') {
		throw new TypeError('Invalid desktop worker result spool');
	}
	requireEngine(engine);
	if (typeof downloadsDir !== 'string' || downloadsDir.length === 0) {
		throw new TypeError('Invalid desktop worker downloads directory');
	}
	if (typeof now !== 'function' || typeof leaseNow !== 'function') {
		throw new TypeError('Invalid desktop worker clock');
	}
	if (
		!Number.isSafeInteger(keepCompletedSpoolHours) ||
		keepCompletedSpoolHours < 0 ||
		keepCompletedSpoolHours > 168
	) {
		throw new TypeError('Invalid desktop worker spool retention');
	}
	if (
		typeof downloadSource !== 'function' ||
		typeof renewLease !== 'function' ||
		typeof removeFile !== 'function'
	) {
		throw new TypeError('Invalid desktop worker source lifecycle');
	}

	const replay = await flushResultSpool({ spool, client }, { signal, now });
	const cutoff = new Date(now().getTime() - keepCompletedSpoolHours * 60 * 60 * 1000);
	const purgedAccepted = spool.purgeAcceptedBefore(cutoff);
	if (replay.remainingPending > 0) {
		return Object.freeze({
			status: 'blocked_pending_delivery',
			replay,
			purgedAccepted
		});
	}
	if (replay.rejected.length > 0) {
		return Object.freeze({
			status: 'dead_lettered',
			code: replay.rejected[0].code,
			replay,
			purgedAccepted
		});
	}

	let lease;
	try {
		lease = await client.claim({ signal });
	} catch (error) {
		if (error?.name === 'AbortError') throw error;
		return Object.freeze({
			status: 'claim_deferred',
			code: safeCode(error, 'worker_claim_failed'),
			replay,
			purgedAccepted
		});
	}
	if (lease === null) {
		return Object.freeze({ status: 'idle', replay, purgedAccepted });
	}

	let source;
	try {
		source = await client.source(lease.jobId, lease.leaseId, { signal });
	} catch (error) {
		if (error?.name === 'AbortError') throw error;
		return Object.freeze({
			status: 'source_deferred',
			jobId: lease.jobId,
			code: safeCode(error, 'worker_source_failed'),
			replay,
			purgedAccepted
		});
	}

	let downloaded;
	try {
		downloaded = await downloadSource(source, { downloadsDir, signal });
	} catch (error) {
		if (error?.name === 'AbortError') throw error;
		return Object.freeze({
			status: 'source_deferred',
			jobId: lease.jobId,
			code: safeCode(error, 'worker_source_download_failed'),
			replay,
			purgedAccepted
		});
	}

	let completion;
	let renewalFailure = null;
	try {
		const processing = await renewLease(
			{ client, lease },
			() =>
				engine.process(
					Object.freeze({
						jobId: lease.jobId,
						pageId: source.pageId,
						path: downloaded.path,
						mimeType: downloaded.mimeType,
						bytes: downloaded.bytes,
						sha256: downloaded.sha256
					}),
					{ signal }
				),
			{ signal, now: leaseNow }
		);
		renewalFailure = processing.renewalFailure;
		completion = completionFromEngine(lease, source, processing.value);
		spool.enqueue(completion, now());
	} catch (error) {
		if (error?.name === 'AbortError') throw error;
		return Object.freeze({
			status: 'processing_deferred',
			jobId: lease.jobId,
			code: safeCode(error, 'worker_processing_failed'),
			renewalFailure,
			replay,
			purgedAccepted
		});
	} finally {
		await removeFile(downloaded.path).catch(() => undefined);
	}

	const delivery = await flushResultSpool({ spool, client }, { limit: 1, signal, now });
	if (delivery.remainingPending > 0) {
		return Object.freeze({
			status: 'spooled',
			jobId: lease.jobId,
			renewalFailure,
			delivery,
			replay,
			purgedAccepted
		});
	}
	if (delivery.rejected.length > 0) {
		return Object.freeze({
			status: 'dead_lettered',
			jobId: lease.jobId,
			code: delivery.rejected[0].code,
			renewalFailure,
			delivery,
			replay,
			purgedAccepted
		});
	}
	return Object.freeze({
		status: 'completed',
		jobId: lease.jobId,
		renewalFailure,
		delivery,
		replay,
		purgedAccepted
	});
}
