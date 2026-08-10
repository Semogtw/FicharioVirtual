import { inspectWorkerStatus } from './status.mjs';
import { discoverLocalOllamaModel } from './model-setup.mjs';
import { resolveWorkerPaths } from './paths.mjs';

const SAFE_CODE = /^[a-z0-9_]{3,96}$/;

function safeFailureCode(error, fallback) {
	return typeof error?.code === 'string' && SAFE_CODE.test(error.code) ? error.code : fallback;
}

export async function runWorkerDoctor(
	{ paths = resolveWorkerPaths(), credentialStore } = {},
	{
		inspectStatus = inspectWorkerStatus,
		discoverModel = discoverLocalOllamaModel,
		baseUrl = 'http://127.0.0.1:11434/',
		fetchImpl = fetch,
		signal
	} = {}
) {
	if (typeof inspectStatus !== 'function' || typeof discoverModel !== 'function') {
		throw new TypeError('Invalid desktop worker doctor dependency');
	}

	const status = await inspectStatus({ paths, ...(credentialStore ? { credentialStore } : {}) });
	if (!status.readyToRun) {
		return Object.freeze({
			ready: false,
			localState: Object.freeze({
				config: status.config.state,
				device: status.device.state,
				model: status.model.state,
				credential: status.credential.state
			}),
			ollama: Object.freeze({ state: 'not_checked', code: null })
		});
	}

	try {
		const discovered = await discoverModel(status.model.model, { baseUrl, fetchImpl, signal });
		if (discovered.digest !== status.model.digest) {
			return Object.freeze({
				ready: false,
				localState: Object.freeze({
					config: 'ready',
					device: 'ready',
					model: 'ready',
					credential: 'ready'
				}),
				ollama: Object.freeze({ state: 'failed', code: 'ollama_model_digest_mismatch' })
			});
		}
		return Object.freeze({
			ready: true,
			localState: Object.freeze({
				config: 'ready',
				device: 'ready',
				model: 'ready',
				credential: 'ready'
			}),
			ollama: Object.freeze({
				state: 'ready',
				code: null,
				model: discovered.model,
				digest: discovered.digest
			})
		});
	} catch (error) {
		if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
		return Object.freeze({
			ready: false,
			localState: Object.freeze({
				config: 'ready',
				device: 'ready',
				model: 'ready',
				credential: 'ready'
			}),
			ollama: Object.freeze({
				state: 'failed',
				code: safeFailureCode(error, 'ollama_preflight_failed')
			})
		});
	}
}
