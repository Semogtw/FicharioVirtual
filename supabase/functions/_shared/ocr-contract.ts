export type OcrWarning = {
	code: string;
	message: string;
};

export type OcrPayload = {
	text: string;
	warnings: readonly OcrWarning[];
	needsReview: boolean;
};

export type OcrClaimState =
	| 'claimed'
	| 'already_complete'
	| 'busy'
	| 'retry_later'
	| 'quota_exhausted'
	| 'consent_required'
	| 'not_authorized'
	| 'not_found'
	| 'invalid_configuration'
	| 'not_retryable';

const OCR_CLAIM_STATES = Object.freeze<OcrClaimState[]>([
	'claimed',
	'already_complete',
	'busy',
	'retry_later',
	'quota_exhausted',
	'consent_required',
	'not_authorized',
	'not_found',
	'invalid_configuration',
	'not_retryable'
]);

export function parseOcrClaimState(value: unknown): OcrClaimState | null {
	return typeof value === 'string' && OCR_CLAIM_STATES.includes(value as OcrClaimState)
		? (value as OcrClaimState)
		: null;
}

export type OcrClaimResult =
	| { state: 'not_authorized' | 'consent_required' | 'invalid_configuration' | 'not_found' }
	| { state: 'already_complete' | 'busy' | 'not_retryable'; jobId: string }
	| {
			state: 'retry_later' | 'quota_exhausted';
			jobId: string;
			nextRetryAt: string;
	  }
	| {
			state: 'claimed';
			jobId: string;
			attemptCount: number;
			usageToday: number;
	  };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/;

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function isValidTimestamp(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const match = TIMESTAMP.exec(value);
	if (!match) return false;
	const [
		,
		yearText,
		monthText,
		dayText,
		hourText,
		minuteText,
		secondText,
		zone,
		,
		offsetHourText,
		offsetMinuteText
	] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const hour = Number(hourText);
	const minute = Number(minuteText);
	const second = Number(secondText);
	if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
		return false;
	}
	if (hour > 23 || minute > 59 || second > 59) return false;
	if (zone !== 'Z') {
		const offsetHour = Number(offsetHourText);
		const offsetMinute = Number(offsetMinuteText);
		if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
			return false;
		}
	}
	return Number.isFinite(Date.parse(value));
}

export function parseOcrClaimResult(value: unknown): OcrClaimResult | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const state = parseOcrClaimState(record.state);
	if (state === null) return null;

	if (
		state === 'not_authorized' ||
		state === 'consent_required' ||
		state === 'invalid_configuration' ||
		state === 'not_found'
	) {
		return hasExactKeys(record, ['state']) ? Object.freeze({ state }) : null;
	}

	if (state === 'already_complete' || state === 'busy' || state === 'not_retryable') {
		return hasExactKeys(record, ['state', 'jobId']) &&
			typeof record.jobId === 'string' &&
			UUID.test(record.jobId)
			? Object.freeze({ state, jobId: record.jobId })
			: null;
	}

	if (state === 'retry_later' || state === 'quota_exhausted') {
		return hasExactKeys(record, ['state', 'jobId', 'nextRetryAt']) &&
			typeof record.jobId === 'string' &&
			UUID.test(record.jobId) &&
			isValidTimestamp(record.nextRetryAt)
			? Object.freeze({ state, jobId: record.jobId, nextRetryAt: record.nextRetryAt })
			: null;
	}

	const attemptCount =
		typeof record.attemptCount === 'number' &&
		Number.isInteger(record.attemptCount) &&
		record.attemptCount >= 1
			? record.attemptCount
			: null;
	const usageToday =
		typeof record.usageToday === 'number' &&
		Number.isInteger(record.usageToday) &&
		record.usageToday >= 1
			? record.usageToday
			: null;
	return hasExactKeys(record, ['state', 'jobId', 'attemptCount', 'usageToday']) &&
		typeof record.jobId === 'string' &&
		UUID.test(record.jobId) &&
		attemptCount !== null &&
		usageToday !== null
		? Object.freeze({ state: 'claimed', jobId: record.jobId, attemptCount, usageToday })
		: null;
}

export type GeminiFailure = {
	code:
		| 'gemini_daily_quota'
		| 'gemini_rate_limited'
		| 'gemini_authentication_failed'
		| 'gemini_model_unavailable'
		| 'gemini_invalid_request'
		| 'gemini_service_unavailable';
	retryable: boolean;
	quotaExhausted: boolean;
	delaySeconds: number | null;
	safeMessage: string;
};

export type GeminiFailureResponse =
	| { status: 202; body: { state: 'quota_exhausted' | 'retry_later' } }
	| { status: number; body: { code: GeminiFailure['code']; retryable: false } };

function invalidResponse(): never {
	throw new TypeError('Invalid OCR response');
}

export function parseOcrPayload(value: string): OcrPayload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		invalidResponse();
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) invalidResponse();
	const record = parsed as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (keys.length !== 2 || keys[0] !== 'text' || keys[1] !== 'warnings') invalidResponse();
	if (typeof record.text !== 'string' || record.text.length > 1_000_000) invalidResponse();
	if (!Array.isArray(record.warnings) || record.warnings.length > 100) invalidResponse();

	const warnings = record.warnings.map((value) => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
		const warning = value as Record<string, unknown>;
		const warningKeys = Object.keys(warning).sort();
		if (warningKeys.length !== 2 || warningKeys[0] !== 'code' || warningKeys[1] !== 'message') {
			invalidResponse();
		}
		if (
			typeof warning.code !== 'string' ||
			!/^[a-z][a-z0-9_]{1,63}$/.test(warning.code) ||
			typeof warning.message !== 'string' ||
			warning.message.trim().length < 1 ||
			warning.message.length > 300
		) {
			invalidResponse();
		}
		return Object.freeze({ code: warning.code, message: warning.message.trim() });
	});

	const text = record.text.trim();
	return Object.freeze({
		text,
		warnings: Object.freeze(warnings),
		needsReview: text.length === 0 || warnings.length > 0
	});
}

export function claimStateHttpStatus(state: unknown): number {
	if (state === 'already_complete') return 200;
	if (state === 'busy' || state === 'retry_later' || state === 'quota_exhausted') return 202;
	if (state === 'consent_required' || state === 'not_authorized') return 403;
	if (state === 'not_found') return 404;
	return 409;
}

export function geminiFailureResponse(
	failure: GeminiFailure,
	providerStatus: number
): GeminiFailureResponse {
	if (failure.quotaExhausted) {
		return Object.freeze({ status: 202, body: Object.freeze({ state: 'quota_exhausted' }) });
	}
	if (failure.retryable) {
		return Object.freeze({ status: 202, body: Object.freeze({ state: 'retry_later' }) });
	}
	const status = providerStatus >= 400 && providerStatus <= 599 ? providerStatus : 502;
	return Object.freeze({
		status,
		body: Object.freeze({ code: failure.code, retryable: false })
	});
}

export function classifyGeminiFailure(status: number, responseBody: string): GeminiFailure {
	const summary = responseBody.slice(0, 8_000).toLowerCase();
	const dailyQuota =
		status === 429 &&
		/(requests? per day|per-day|daily quota|\brpd\b|quota[^\n]{0,80}day)/i.test(summary);
	if (dailyQuota) {
		return Object.freeze({
			code: 'gemini_daily_quota',
			retryable: false,
			quotaExhausted: true,
			delaySeconds: null,
			safeMessage: 'A cota diária do provedor foi atingida.'
		});
	}
	if (status === 429) {
		return Object.freeze({
			code: 'gemini_rate_limited',
			retryable: true,
			quotaExhausted: false,
			delaySeconds: 60,
			safeMessage: 'O provedor limitou temporariamente as solicitações.'
		});
	}
	if (status === 401 || status === 403) {
		return Object.freeze({
			code: 'gemini_authentication_failed',
			retryable: false,
			quotaExhausted: false,
			delaySeconds: null,
			safeMessage: 'A configuração do provedor de leitura foi rejeitada.'
		});
	}
	if (status === 404) {
		return Object.freeze({
			code: 'gemini_model_unavailable',
			retryable: false,
			quotaExhausted: false,
			delaySeconds: null,
			safeMessage: 'O modelo configurado não está disponível.'
		});
	}
	if (status === 400 || status === 422) {
		return Object.freeze({
			code: 'gemini_invalid_request',
			retryable: false,
			quotaExhausted: false,
			delaySeconds: null,
			safeMessage: 'O provedor rejeitou o formato da solicitação.'
		});
	}
	return Object.freeze({
		code: 'gemini_service_unavailable',
		retryable: status === 408 || status === 425 || status >= 500,
		quotaExhausted: false,
		delaySeconds: status === 408 || status === 425 || status >= 500 ? 30 : null,
		safeMessage: 'O serviço de leitura está temporariamente indisponível.'
	});
}
