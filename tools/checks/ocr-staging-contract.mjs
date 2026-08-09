import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** @type {Readonly<Record<string, readonly number[]>>} */
const FONT = Object.freeze({
	' ': [0, 0, 0, 0, 0, 0, 0],
	1: [4, 12, 4, 4, 4, 4, 14],
	2: [14, 17, 1, 2, 4, 8, 31],
	7: [31, 1, 2, 4, 8, 8, 8],
	8: [14, 17, 17, 14, 17, 17, 14],
	A: [14, 17, 17, 31, 17, 17, 17],
	C: [14, 17, 16, 16, 16, 17, 14],
	F: [31, 16, 16, 30, 16, 16, 16],
	H: [17, 17, 17, 31, 17, 17, 17],
	I: [14, 4, 4, 4, 4, 4, 14],
	O: [14, 17, 17, 17, 17, 17, 14],
	R: [30, 17, 17, 30, 20, 18, 17]
});

/** @param {Uint8Array} bytes */
function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Uint8Array} data */
function pngChunk(type, data) {
	const typeBytes = Buffer.from(type, 'ascii');
	const chunk = Buffer.alloc(12 + data.byteLength);
	chunk.writeUInt32BE(data.byteLength, 0);
	typeBytes.copy(chunk, 4);
	Buffer.from(data).copy(chunk, 8);
	chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
	return chunk;
}

/**
 * @param {string} nonce
 * @returns {Uint8Array}
 */
export function createOcrProbePng(nonce) {
	if (!/^[a-z0-9-]{8,80}$/i.test(nonce)) throw new TypeError('Invalid OCR probe nonce');
	const text = 'FICHARIO OCR 2718';
	const scale = 8;
	const margin = 24;
	const width = margin * 2 + text.length * 6 * scale;
	const height = margin * 2 + 7 * scale;
	const scanlines = Buffer.alloc((width + 1) * height, 255);
	for (let y = 0; y < height; y += 1) scanlines[y * (width + 1)] = 0;

	for (let characterIndex = 0; characterIndex < text.length; characterIndex += 1) {
		const rows = FONT[text[characterIndex]];
		if (!rows) throw new Error(`Unsupported OCR probe character: ${text[characterIndex]}`);
		for (let row = 0; row < rows.length; row += 1) {
			for (let column = 0; column < 5; column += 1) {
				if ((rows[row] & (1 << (4 - column))) === 0) continue;
				for (let dy = 0; dy < scale; dy += 1) {
					for (let dx = 0; dx < scale; dx += 1) {
						const x = margin + (characterIndex * 6 + column) * scale + dx;
						const y = margin + row * scale + dy;
						scanlines[y * (width + 1) + 1 + x] = 0;
					}
				}
			}
		}
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 0;
	const metadata = Buffer.from(`probe\0${nonce}`, 'latin1');
	return Uint8Array.from(
		Buffer.concat([
			Buffer.from(PNG_SIGNATURE),
			pngChunk('IHDR', ihdr),
			pngChunk('tEXt', metadata),
			pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
			pngChunk('IEND', new Uint8Array())
		])
	);
}

/**
 * @typedef {'pass' | 'fail' | 'not_run'} OcrReportStatus
 * @typedef {'configuration' | 'authentication' | 'authorization' | 'consent' | 'import' | 'invocation' | 'persistence' | 'cleanup' | 'confirmation' | null} OcrFailureStage
 * @typedef {'success' | 'failure' | 'not_required'} CleanupStatus
 */

/**
 * @param {{
 *   status: OcrReportStatus;
 *   failureStage: OcrFailureStage;
 *   stages: {
 *     authenticated: unknown;
 *     authorized: unknown;
 *     consentRecorded: unknown;
 *     importCreated: unknown;
 *     functionCompleted: unknown;
 *     persistenceVerified: unknown;
 *   };
 *   outcome: {
 *     documentStatus: unknown;
 *     pageStatus: unknown;
 *     jobStatus: unknown;
 *     needsReview: unknown;
 *     warningCount: unknown;
 *     attemptCount: unknown;
 *     tokens: { fichario: unknown; ocr: unknown; numericProbe: unknown };
 *   };
 *   diagnostic?: {
 *     httpStatus?: unknown;
 *     errorKind?: unknown;
 *     providerStatus?: unknown;
 *     providerErrorKind?: unknown;
 *     providerErrorCode?: unknown;
 *   };
 *   cleanup: { document: CleanupStatus; session: CleanupStatus };
 * }} input
 */
export function createOcrStagingReport({
	status,
	failureStage,
	stages,
	outcome,
	diagnostic = {},
	cleanup
}) {
	/** @param {unknown} value */
	const terminalStatus = (value) => (value === 'ready' || value === 'needs_review' ? value : null);
	/** @param {unknown} value */
	const nullableBoolean = (value) => (typeof value === 'boolean' ? value : null);
	/** @param {unknown} value */
	const nullableCount = (value) =>
		Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
	/** @param {unknown} value */
	const cleanupStatus = (value) =>
		value === 'success' || value === 'failure' || value === 'not_required' ? value : 'failure';
	/** @param {unknown} value */
	const nullableHttpStatus = (value) =>
		Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : null;
	/** @param {unknown} value */
	const providerErrorKind = (value) =>
		[
			'quota',
			'rate_limit',
			'authentication',
			'model',
			'invalid_request',
			'service_unavailable'
		].includes(typeof value === 'string' ? value : '')
			? value
			: null;
	/** @param {unknown} value */
	const providerErrorCode = (value) =>
		[
			'gemini_daily_quota',
			'gemini_rate_limited',
			'gemini_authentication_failed',
			'gemini_model_unavailable',
			'gemini_invalid_request',
			'gemini_service_unavailable'
		].includes(typeof value === 'string' ? value : '')
			? value
			: null;
	/** @param {unknown} value */
	const errorKind = (value) =>
		['FunctionsFetchError', 'FunctionsHttpError', 'FunctionsRelayError'].includes(
			typeof value === 'string' ? value : ''
		)
			? value
			: null;
	/** @param {unknown} value */
	const sanitizedFailureStage = (value) =>
		[
			'configuration',
			'authentication',
			'authorization',
			'consent',
			'import',
			'invocation',
			'persistence',
			'cleanup',
			'confirmation'
		].includes(typeof value === 'string' ? value : '')
			? value
			: null;

	return {
		schemaVersion: 2,
		status: status === 'pass' || status === 'not_run' ? status : 'fail',
		failureStage: sanitizedFailureStage(failureStage),
		stages: {
			authenticated: stages.authenticated === true,
			authorized: stages.authorized === true,
			consentRecorded: stages.consentRecorded === true,
			importCreated: stages.importCreated === true,
			functionCompleted: stages.functionCompleted === true,
			persistenceVerified: stages.persistenceVerified === true
		},
		outcome: {
			documentStatus: terminalStatus(outcome.documentStatus),
			pageStatus: terminalStatus(outcome.pageStatus),
			jobStatus: terminalStatus(outcome.jobStatus),
			needsReview: nullableBoolean(outcome.needsReview),
			warningCount: nullableCount(outcome.warningCount),
			attemptCount: nullableCount(outcome.attemptCount),
			tokens: {
				fichario: nullableBoolean(outcome.tokens.fichario),
				ocr: nullableBoolean(outcome.tokens.ocr),
				numericProbe: nullableBoolean(outcome.tokens.numericProbe)
			}
		},
		diagnostic: {
			httpStatus: nullableHttpStatus(diagnostic.httpStatus),
			errorKind: errorKind(diagnostic.errorKind),
			providerStatus: nullableHttpStatus(diagnostic.providerStatus),
			providerErrorKind: providerErrorKind(diagnostic.providerErrorKind),
			providerErrorCode: providerErrorCode(diagnostic.providerErrorCode)
		},
		cleanup: {
			document: cleanupStatus(cleanup.document),
			session: cleanupStatus(cleanup.session)
		}
	};
}

/**
 * Keep failed function invocation diagnostics bounded to the HTTP status, SDK
 * error class, and a small allowlist of provider classifications. Response
 * bodies and provider messages may contain secrets or user data and must not
 * enter CI logs or artifacts.
 *
 * @param {{ error?: { name?: unknown } | null; response?: Response | { status?: unknown } | null }} input
 */
export async function createOcrInvocationDiagnostic({ error, response }) {
	const status = response?.status;
	const httpStatus =
		typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
			? status
			: null;
	const name = error?.name;
	const errorKind =
		typeof name === 'string' &&
		['FunctionsFetchError', 'FunctionsHttpError', 'FunctionsRelayError'].includes(name)
			? name
			: null;
	let providerErrorCode = null;
	if (response && typeof response.clone === 'function') {
		try {
			const contentLength = Number(response.headers?.get('content-length') ?? '');
			if (!Number.isFinite(contentLength) || contentLength <= 4096) {
				const body = await response.clone().json();
				const candidate =
					body && typeof body === 'object' && !Array.isArray(body)
						? /** @type {{ code?: unknown }} */ (body).code
						: null;
				providerErrorCode = [
					'gemini_daily_quota',
					'gemini_rate_limited',
					'gemini_authentication_failed',
					'gemini_model_unavailable',
					'gemini_invalid_request',
					'gemini_service_unavailable'
				].includes(typeof candidate === 'string' ? candidate : '')
					? candidate
					: null;
			}
		} catch {
			providerErrorCode = null;
		}
	}
	const kindByCode = {
		gemini_daily_quota: 'quota',
		gemini_rate_limited: 'rate_limit',
		gemini_authentication_failed: 'authentication',
		gemini_model_unavailable: 'model',
		gemini_invalid_request: 'invalid_request',
		gemini_service_unavailable: 'service_unavailable'
	};
	return {
		httpStatus,
		errorKind,
		providerStatus: providerErrorCode ? httpStatus : null,
		providerErrorKind: providerErrorCode ? kindByCode[providerErrorCode] : null,
		providerErrorCode
	};
}

/**
 * @param {{
 *   httpStatus: number | null;
 *   errorKind: string | null;
 *   providerStatus: number | null;
 *   providerErrorKind: string | null;
 *   providerErrorCode: string | null;
 * }} diagnostic
 */
export function formatOcrInvocationFailure(diagnostic) {
	const status =
		diagnostic.httpStatus == null ? 'unknown HTTP status' : `HTTP ${diagnostic.httpStatus}`;
	const kind = diagnostic.errorKind ? ` (${diagnostic.errorKind})` : '';
	const provider = diagnostic.providerErrorKind
		? `; provider=${diagnostic.providerErrorKind}${diagnostic.providerErrorCode ? `/${diagnostic.providerErrorCode}` : ''}`
		: '';
	return `process-ocr failed: ${status}${kind}${provider}`;
}

/** @param {unknown} text */
export function normalizeOcrProbeText(text) {
	if (typeof text !== 'string') return '';
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * @param {{ data: unknown }} input
 */
export function assertOcrInvocation({ data }) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error('OCR staging contract failed: Edge Function returned an invalid body');
	}
	const result = /** @type {{ state?: unknown; needsReview?: unknown; warningCount?: unknown }} */ (
		data
	);
	if (result.state !== 'complete') {
		throw new Error(
			`OCR staging contract failed: unexpected function state ${String(result.state)}`
		);
	}
	if (typeof result.needsReview !== 'boolean') {
		throw new Error('OCR staging contract failed: needsReview is not boolean');
	}
	if (!Number.isInteger(result.warningCount) || Number(result.warningCount) < 0) {
		throw new Error('OCR staging contract failed: warningCount is invalid');
	}
}

/**
 * @param {{
 *   document: Record<string, unknown> | null;
 *   page: Record<string, unknown> | null;
 *   job: Record<string, unknown> | null;
 * }} input
 */
export function assertOcrPersistence({ document, page, job }) {
	if (!document || !page || !job) {
		throw new Error('OCR staging contract failed: persisted OCR rows are missing');
	}
	const pageStatus = page.status;
	if (pageStatus !== 'ready' && pageStatus !== 'needs_review') {
		throw new Error(`OCR staging contract failed: page is not terminal (${String(pageStatus)})`);
	}
	if (document.status !== pageStatus || job.status !== pageStatus) {
		throw new Error('OCR staging contract failed: document, page, and job states diverged');
	}
	if (page.extraction_source !== 'ocr') {
		throw new Error('OCR staging contract failed: page extraction source is not OCR');
	}
	const normalized = normalizeOcrProbeText(page.ocr_raw_text);
	for (const token of ['fichario', 'ocr', '2718']) {
		if (!normalized.split(' ').includes(token)) {
			throw new Error(`OCR staging contract failed: transcript is missing token ${token}`);
		}
	}
	if (!Array.isArray(page.warnings)) {
		throw new Error('OCR staging contract failed: page warnings are not an array');
	}
	if (!Number.isInteger(job.attempt_count) || Number(job.attempt_count) < 1) {
		throw new Error('OCR staging contract failed: OCR attempt count was not persisted');
	}
	if (job.last_error_code != null) {
		throw new Error('OCR staging contract failed: completed job retained an error code');
	}
	if (typeof job.finished_at !== 'string' || Number.isNaN(Date.parse(job.finished_at))) {
		throw new Error('OCR staging contract failed: completed job has no finish timestamp');
	}
}
