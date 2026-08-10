const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MODEL = /^[A-Za-z0-9._:/-]+$/;
const MODEL_VERSION = /^[A-Za-z0-9._:/+-]+$/;
const WARNING_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const CONTENT_TYPES = new Set(['printed', 'handwritten', 'mixed', 'unknown']);
const BACKENDS = new Set(['transformers', 'ollama']);
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_WARNINGS = 100;
const MAX_WARNING_MESSAGE_LENGTH = 300;
const MAX_TIMING_MS = 86_400_000;

function exactKeys(record, expected) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validModel(value, pattern) {
	return (
		typeof value === 'string' && value.length >= 1 && value.length <= 128 && pattern.test(value)
	);
}

function parseWarnings(value) {
	if (!Array.isArray(value) || value.length > MAX_WARNINGS) return null;
	const warnings = [];
	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
		if (!exactKeys(item, ['code', 'message'])) return null;
		if (typeof item.code !== 'string' || !WARNING_CODE.test(item.code)) return null;
		if (
			typeof item.message !== 'string' ||
			item.message !== item.message.trim() ||
			item.message.length < 1 ||
			item.message.length > MAX_WARNING_MESSAGE_LENGTH ||
			// eslint-disable-next-line no-control-regex -- matches the backend contract intentionally
			/[\u0000-\u001f\u007f]/.test(item.message)
		) {
			return null;
		}
		warnings.push(Object.freeze({ code: item.code, message: item.message }));
	}
	return Object.freeze(warnings);
}

export function parseCompletionRequest(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	if (
		!exactKeys(value, [
			'action',
			'jobId',
			'leaseId',
			'sourceSha256',
			'backend',
			'modelId',
			'modelVersion',
			'rawText',
			'correctedText',
			'contentType',
			'warnings',
			'needsReview',
			'timingMs'
		]) ||
		value.action !== 'complete' ||
		typeof value.jobId !== 'string' ||
		!UUID.test(value.jobId) ||
		typeof value.leaseId !== 'string' ||
		!UUID.test(value.leaseId) ||
		typeof value.sourceSha256 !== 'string' ||
		!SHA256.test(value.sourceSha256) ||
		typeof value.backend !== 'string' ||
		!BACKENDS.has(value.backend) ||
		!validModel(value.modelId, MODEL) ||
		!validModel(value.modelVersion, MODEL_VERSION) ||
		typeof value.rawText !== 'string' ||
		value.rawText.length > MAX_TEXT_LENGTH ||
		(value.correctedText !== null &&
			(typeof value.correctedText !== 'string' || value.correctedText.length > MAX_TEXT_LENGTH)) ||
		typeof value.contentType !== 'string' ||
		!CONTENT_TYPES.has(value.contentType) ||
		typeof value.needsReview !== 'boolean' ||
		!Number.isSafeInteger(value.timingMs) ||
		value.timingMs < 0 ||
		value.timingMs > MAX_TIMING_MS
	) {
		return null;
	}
	const warnings = parseWarnings(value.warnings);
	if (warnings === null) return null;
	return Object.freeze({ ...value, warnings });
}

export function requireCompletionRequest(value) {
	const parsed = parseCompletionRequest(value);
	if (!parsed) throw new TypeError('Invalid desktop worker completion payload');
	return parsed;
}
