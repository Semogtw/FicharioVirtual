export type DesktopWorkerWarning = Readonly<{
	code: string;
	message: string;
}>;

export type DesktopOcrContentType = 'printed' | 'handwritten' | 'mixed' | 'unknown';

export type DesktopWorkerRequest =
	| Readonly<{ action: 'claim' }>
	| Readonly<{ action: 'renew' | 'source'; jobId: string; leaseId: string }>
	| Readonly<{
			action: 'complete';
			jobId: string;
			leaseId: string;
			sourceSha256: string;
			backend: 'transformers' | 'ollama';
			modelId: string;
			modelVersion: string;
			rawText: string;
			correctedText: string | null;
			contentType: DesktopOcrContentType;
			warnings: readonly DesktopWorkerWarning[];
			needsReview: boolean;
			timingMs: number;
	  }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MODEL = /^[A-Za-z0-9._:/-]+$/;
const MODEL_VERSION = /^[A-Za-z0-9._:/+-]+$/;
const CONTENT_TYPES = Object.freeze<readonly DesktopOcrContentType[]>([
	'printed',
	'handwritten',
	'mixed',
	'unknown'
]);
const WARNING_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_WARNINGS = 100;
const MAX_WARNING_MESSAGE_LENGTH = 300;
const MAX_TIMING_MS = 86_400_000;

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isContentType(value: unknown): value is DesktopOcrContentType {
	return typeof value === 'string' && CONTENT_TYPES.includes(value as DesktopOcrContentType);
}

function parseWarnings(value: unknown): readonly DesktopWorkerWarning[] | null {
	if (!Array.isArray(value) || value.length > MAX_WARNINGS) return null;
	const warnings: DesktopWorkerWarning[] = [];
	for (const item of value) {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
		const warning = item as Record<string, unknown>;
		if (!hasExactKeys(warning, ['code', 'message'])) return null;
		if (typeof warning.code !== 'string' || !WARNING_CODE.test(warning.code)) return null;
		if (
			typeof warning.message !== 'string' ||
			warning.message !== warning.message.trim() ||
			warning.message.length < 1 ||
			warning.message.length > MAX_WARNING_MESSAGE_LENGTH ||
			// eslint-disable-next-line no-control-regex -- reject ASCII controls from user-visible warning text
			/[\u0000-\u001f\u007f]/.test(warning.message)
		) {
			return null;
		}
		warnings.push(Object.freeze({ code: warning.code, message: warning.message }));
	}
	return Object.freeze(warnings);
}

export function parseDesktopWorkerRequest(value: unknown): DesktopWorkerRequest | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;

	if (record.action === 'claim' && hasExactKeys(record, ['action'])) {
		return Object.freeze({ action: 'claim' });
	}

	if (
		(record.action === 'renew' || record.action === 'source') &&
		hasExactKeys(record, ['action', 'jobId', 'leaseId']) &&
		typeof record.jobId === 'string' &&
		UUID.test(record.jobId) &&
		typeof record.leaseId === 'string' &&
		UUID.test(record.leaseId)
	) {
		return Object.freeze({ action: record.action, jobId: record.jobId, leaseId: record.leaseId });
	}

	if (
		record.action !== 'complete' ||
		!hasExactKeys(record, [
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
		typeof record.jobId !== 'string' ||
		!UUID.test(record.jobId) ||
		typeof record.leaseId !== 'string' ||
		!UUID.test(record.leaseId) ||
		typeof record.sourceSha256 !== 'string' ||
		!SHA256_HEX.test(record.sourceSha256) ||
		(record.backend !== 'transformers' && record.backend !== 'ollama') ||
		typeof record.modelId !== 'string' ||
		record.modelId.length < 1 ||
		record.modelId.length > 128 ||
		!MODEL.test(record.modelId) ||
		typeof record.modelVersion !== 'string' ||
		record.modelVersion.length < 1 ||
		record.modelVersion.length > 128 ||
		!MODEL_VERSION.test(record.modelVersion) ||
		typeof record.rawText !== 'string' ||
		record.rawText.length > MAX_TEXT_LENGTH ||
		(record.correctedText !== null &&
			(typeof record.correctedText !== 'string' ||
				record.correctedText.length > MAX_TEXT_LENGTH)) ||
		!isContentType(record.contentType) ||
		typeof record.needsReview !== 'boolean' ||
		typeof record.timingMs !== 'number' ||
		!Number.isInteger(record.timingMs) ||
		record.timingMs < 0 ||
		record.timingMs > MAX_TIMING_MS
	) {
		return null;
	}

	const warnings = parseWarnings(record.warnings);
	if (warnings === null) return null;

	return Object.freeze({
		action: 'complete',
		jobId: record.jobId,
		leaseId: record.leaseId,
		sourceSha256: record.sourceSha256,
		backend: record.backend,
		modelId: record.modelId,
		modelVersion: record.modelVersion,
		rawText: record.rawText,
		correctedText: record.correctedText,
		contentType: record.contentType,
		warnings,
		needsReview: record.needsReview,
		timingMs: record.timingMs
	});
}
