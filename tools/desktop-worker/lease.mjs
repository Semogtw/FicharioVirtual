import { DesktopWorkerApiError } from './client.mjs';

function safeRenewalFailure(error) {
	if (error instanceof DesktopWorkerApiError) {
		return Object.freeze({ code: error.code, httpStatus: error.httpStatus });
	}
	if (error?.name === 'TimeoutError') {
		return Object.freeze({ code: 'worker_request_timeout', httpStatus: 0 });
	}
	return Object.freeze({ code: 'worker_lease_renewal_failed', httpStatus: 0 });
}

function abortableSleep(milliseconds, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
			return;
		}
		let timeout;
		const cleanup = () => signal?.removeEventListener('abort', abort);
		const finish = () => {
			cleanup();
			resolve();
		};
		const abort = () => {
			clearTimeout(timeout);
			cleanup();
			reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
		};
		timeout = setTimeout(finish, milliseconds);
		signal?.addEventListener('abort', abort, { once: true });
	});
}

function renewalDelay(leaseExpiresAt, nowMs) {
	const expiry = Date.parse(leaseExpiresAt);
	if (!Number.isFinite(expiry)) throw new TypeError('Invalid desktop worker lease expiry');
	const remaining = expiry - nowMs;
	if (remaining <= 0) return 0;
	return Math.max(1_000, Math.min(60_000, Math.floor(remaining / 2)));
}

export async function runWithLeaseRenewal(
	{ client, lease },
	operation,
	{ signal, now = () => Date.now(), sleep = abortableSleep } = {}
) {
	if (!client || typeof client.renew !== 'function') {
		throw new TypeError('Invalid desktop worker API client');
	}
	if (
		!lease ||
		typeof lease !== 'object' ||
		typeof lease.jobId !== 'string' ||
		typeof lease.leaseId !== 'string' ||
		typeof lease.leaseExpiresAt !== 'string'
	) {
		throw new TypeError('Invalid desktop worker lease');
	}
	if (typeof operation !== 'function') throw new TypeError('Invalid desktop worker lease operation');
	if (typeof now !== 'function' || typeof sleep !== 'function') {
		throw new TypeError('Invalid desktop worker lease scheduler');
	}

	let currentLease = lease;
	let renewalFailure = null;
	let stopped = false;
	const stopController = new AbortController();
	const renewalSignal = signal
		? AbortSignal.any([signal, stopController.signal])
		: stopController.signal;

	const renewalLoop = (async () => {
		while (!stopped && !renewalFailure) {
			const delay = renewalDelay(currentLease.leaseExpiresAt, now());
			try {
				await sleep(delay, renewalSignal);
			} catch (error) {
				if (renewalSignal.aborted) return;
				renewalFailure = safeRenewalFailure(error);
				return;
			}
			if (stopped || renewalSignal.aborted) return;
			try {
				currentLease = await client.renew(currentLease.jobId, currentLease.leaseId, {
					signal
				});
			} catch (error) {
				if (error?.name === 'AbortError' && signal?.aborted) return;
				renewalFailure = safeRenewalFailure(error);
				return;
			}
		}
	})();

	try {
		const value = await operation({
			getLease: () => currentLease,
			getRenewalFailure: () => renewalFailure
		});
		return Object.freeze({ value, lease: currentLease, renewalFailure });
	} finally {
		stopped = true;
		stopController.abort(new DOMException('Lease renewal stopped', 'AbortError'));
		await renewalLoop;
	}
}
