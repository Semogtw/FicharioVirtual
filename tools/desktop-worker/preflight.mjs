import { runWorkerDoctor } from './doctor.mjs';

const SAFE_CODE = /^[a-z0-9_]{3,96}$/;

export async function checkWorkerPreflight({ doctor = runWorkerDoctor, signal } = {}) {
	if (typeof doctor !== 'function') throw new TypeError('Invalid desktop worker preflight doctor');
	const result = await doctor({}, { signal });
	if (result.ready === true) {
		return Object.freeze({ ready: true, code: null });
	}
	const code =
		result?.ollama?.state === 'failed' &&
		typeof result.ollama.code === 'string' &&
		SAFE_CODE.test(result.ollama.code)
			? result.ollama.code
			: 'worker_preflight_not_ready';
	return Object.freeze({ ready: false, code });
}
