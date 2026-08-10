const SHA256 = /^[0-9a-f]{64}$/;
const MODEL = /^[A-Za-z0-9._:/-]+$/;

export const WORKER_PROTOCOL_VERSION = 1;

export function buildWorkerCapabilities(config, modelLock) {
	if (
		!config ||
		typeof config !== 'object' ||
		Array.isArray(config) ||
		!Number.isSafeInteger(config.maxConcurrency) ||
		config.maxConcurrency < 1 ||
		config.maxConcurrency > 8
	) {
		throw new TypeError('Invalid desktop worker config for capabilities');
	}
	if (
		!modelLock ||
		typeof modelLock !== 'object' ||
		Array.isArray(modelLock) ||
		modelLock.backend !== 'ollama' ||
		typeof modelLock.model !== 'string' ||
		!MODEL.test(modelLock.model) ||
		typeof modelLock.digest !== 'string' ||
		!SHA256.test(modelLock.digest)
	) {
		throw new TypeError('Invalid desktop worker model lock for capabilities');
	}

	return Object.freeze({
		protocolVersion: WORKER_PROTOCOL_VERSION,
		backend: 'ollama',
		model: modelLock.model,
		modelDigest: modelLock.digest,
		maxConcurrency: config.maxConcurrency
	});
}
