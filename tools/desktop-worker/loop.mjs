import { runWorkerCycle } from './runner.mjs';

const RETRY_STATUSES = new Set([
	'blocked_pending_delivery',
	'claim_deferred',
	'source_deferred',
	'processing_deferred',
	'spooled'
]);

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

function secondsToMilliseconds(seconds, label) {
	if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) {
		throw new TypeError(`Invalid desktop worker ${label}`);
	}
	return seconds * 1000;
}

function retryDelay(baseMs, maximumMs, failures) {
	const exponent = Math.min(Math.max(failures - 1, 0), 6);
	return Math.min(maximumMs, baseMs * 2 ** exponent);
}

export function nextWorkerDelay(status, consecutiveFailures, config) {
	if (typeof status !== 'string') throw new TypeError('Invalid desktop worker cycle status');
	if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 0) {
		throw new TypeError('Invalid desktop worker failure count');
	}
	const pollMs = secondsToMilliseconds(config?.pollIntervalSeconds, 'pollIntervalSeconds');
	const idleMs = secondsToMilliseconds(config?.idlePollIntervalSeconds, 'idlePollIntervalSeconds');
	if (idleMs < pollMs) throw new TypeError('Desktop worker idle polling must not be faster');
	if (status === 'idle') return idleMs;
	if (status === 'completed') return pollMs;
	if (RETRY_STATUSES.has(status)) {
		return retryDelay(pollMs, idleMs, Math.max(consecutiveFailures, 1));
	}
	throw new TypeError('Unknown desktop worker cycle status');
}

export async function runWorkerLoop(
	context,
	config,
	{
		signal,
		runCycle = runWorkerCycle,
		sleep = abortableSleep,
		onStatus = () => undefined,
		maxCycles = Number.POSITIVE_INFINITY
	} = {}
) {
	if (
		typeof runCycle !== 'function' ||
		typeof sleep !== 'function' ||
		typeof onStatus !== 'function'
	) {
		throw new TypeError('Invalid desktop worker loop dependency');
	}
	if (
		maxCycles !== Number.POSITIVE_INFINITY &&
		(!Number.isSafeInteger(maxCycles) || maxCycles < 1 || maxCycles > 1_000_000)
	) {
		throw new TypeError('Invalid desktop worker maxCycles');
	}
	// Validate polling configuration before starting any remote work.
	nextWorkerDelay('completed', 0, config);

	let cycles = 0;
	let consecutiveFailures = 0;
	while (cycles < maxCycles) {
		if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

		const result = await runCycle(context, {
			signal,
			keepCompletedSpoolHours: config.keepCompletedSpoolHours
		});
		cycles += 1;
		consecutiveFailures = RETRY_STATUSES.has(result.status) ? consecutiveFailures + 1 : 0;
		await onStatus(
			Object.freeze({
				cycle: cycles,
				status: result.status,
				consecutiveFailures,
				code: typeof result.code === 'string' ? result.code : null
			})
		);

		if (cycles >= maxCycles) break;
		const delay = nextWorkerDelay(result.status, consecutiveFailures, config);
		await sleep(delay, signal);
	}

	return Object.freeze({ cycles, consecutiveFailures });
}
