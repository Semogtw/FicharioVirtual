import { DesktopWorkerApiError } from './client.mjs';

function safeFailure(error) {
	if (error instanceof DesktopWorkerApiError) {
		return Object.freeze({
			code: error.code,
			httpStatus: error.httpStatus
		});
	}
	if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
		return Object.freeze({
			code: error.name === 'TimeoutError' ? 'worker_request_timeout' : 'worker_request_aborted',
			httpStatus: 0
		});
	}
	return Object.freeze({ code: 'worker_delivery_failed', httpStatus: 0 });
}

export async function flushResultSpool(
	{ spool, client },
	{ limit = 20, signal, now = () => new Date() } = {}
) {
	if (!spool || typeof spool.listPending !== 'function') {
		throw new TypeError('Invalid desktop worker result spool');
	}
	if (!client || typeof client.complete !== 'function') {
		throw new TypeError('Invalid desktop worker API client');
	}
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new TypeError('Invalid desktop worker delivery limit');
	}
	if (typeof now !== 'function') throw new TypeError('Invalid desktop worker clock');

	const delivered = [];
	const failures = [];
	for (const entry of spool.listPending(limit)) {
		if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
		if (!spool.markAttempt(entry.jobId, now())) continue;
		try {
			const receipt = await client.complete(entry.result, { signal });
			if (!spool.markAccepted(entry.jobId, now())) {
				throw new Error('Desktop worker spool acceptance race');
			}
			delivered.push(
				Object.freeze({
					jobId: entry.jobId,
					resultId: receipt.resultId,
					status: receipt.status,
					idempotentReplay: receipt.idempotentReplay,
					cleanupPending: receipt.cleanupPending
				})
			);
		} catch (error) {
			if (error?.name === 'AbortError') throw error;
			failures.push(Object.freeze({ jobId: entry.jobId, ...safeFailure(error) }));
		}
	}

	return Object.freeze({
		delivered: Object.freeze(delivered),
		failures: Object.freeze(failures),
		remainingPending: spool.listPending(100).length
	});
}
