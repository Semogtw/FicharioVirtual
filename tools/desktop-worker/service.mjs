import { runWorkerLoop } from './loop.mjs';
import { createLockedOcrEngine } from './model-lock.mjs';
import { resolveWorkerPaths } from './paths.mjs';
import { createWorkerRuntime } from './runtime.mjs';

function safeErrorCode(error) {
	if (
		error &&
		typeof error === 'object' &&
		typeof error.code === 'string' &&
		/^[a-z0-9_]{3,96}$/.test(error.code)
	) {
		return error.code;
	}
	return 'worker_service_failed';
}

export async function runDesktopWorkerService(
	{
		paths = resolveWorkerPaths(),
		createEngine = createLockedOcrEngine,
		createRuntime = createWorkerRuntime,
		runLoop = runWorkerLoop,
		onStatus = () => undefined,
		onError = () => undefined
	} = {},
	{ signal } = {}
) {
	if (
		typeof createEngine !== 'function' ||
		typeof createRuntime !== 'function' ||
		typeof runLoop !== 'function' ||
		typeof onStatus !== 'function' ||
		typeof onError !== 'function'
	) {
		throw new TypeError('Invalid desktop worker service dependency');
	}
	let runtime;
	try {
		const engine = await createEngine(paths);
		runtime = await createRuntime({ engine, paths }, { signal });
		const summary = await runLoop(runtime.context, runtime.config, { signal, onStatus });
		return Object.freeze({ status: 'stopped', ...summary });
	} catch (error) {
		if (error?.name === 'AbortError' && signal?.aborted) {
			return Object.freeze({ status: 'stopped', cycles: null, consecutiveFailures: null });
		}
		const code = safeErrorCode(error);
		await onError(Object.freeze({ status: 'failed', code }));
		return Object.freeze({ status: 'failed', code });
	} finally {
		runtime?.close();
	}
}

export function createProcessShutdownSignal(processObject = process) {
	if (!processObject || typeof processObject.once !== 'function') {
		throw new TypeError('Invalid desktop worker process object');
	}
	const controller = new AbortController();
	let closed = false;
	const stop = (signalName) => {
		if (controller.signal.aborted) return;
		controller.abort(new DOMException(`Worker shutdown requested by ${signalName}`, 'AbortError'));
	};
	const onSigterm = () => stop('SIGTERM');
	const onSigint = () => stop('SIGINT');
	processObject.once('SIGTERM', onSigterm);
	processObject.once('SIGINT', onSigint);
	return Object.freeze({
		signal: controller.signal,
		close() {
			if (closed) return;
			closed = true;
			processObject.removeListener('SIGTERM', onSigterm);
			processObject.removeListener('SIGINT', onSigint);
		}
	});
}
