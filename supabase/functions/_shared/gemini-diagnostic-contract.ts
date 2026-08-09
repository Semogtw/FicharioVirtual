import { classifyGeminiFailure, type GeminiFailure } from './ocr-contract.ts';
import {
	GeminiHttpError,
	GeminiResponseError,
	GeminiTransportError
} from './gemini-ocr-client.ts';

export const GEMINI_DIAGNOSTIC_BODY = Object.freeze({
	diagnostic: 'gemini-provider-v2'
});

export const OCR_BOUNDARY_PROBE_BODY = Object.freeze({
	diagnostic: 'ocr-boundary-v1'
});

export const GEMINI_DIAGNOSTIC_PAGE = Object.freeze({
	pageId: '33333333-3333-4333-8333-333333333333',
	pageNumber: 1,
	mimeType: 'image/png'
});

// Deterministic 1x1 PNG. It contains no user data, is never accepted from callers,
// and is never persisted.
export const GEMINI_DIAGNOSTIC_FIXTURE_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const DIAGNOSTIC_CODES = Object.freeze([
	'provider_ok',
	'gemini_daily_quota',
	'gemini_rate_limited',
	'gemini_authentication_failed',
	'gemini_model_unavailable',
	'gemini_invalid_request',
	'gemini_service_unavailable',
	'provider_response_invalid',
	'provider_transport_failed',
	'provider_not_configured',
	'diagnostic_forbidden',
	'diagnostic_bad_request',
	'wrapper_response_invalid',
	'wrapper_http_failed'
] as const);

const DIAGNOSTIC_CATEGORIES = Object.freeze([
	'provider',
	'transport',
	'configuration',
	'authorization',
	'request',
	'wrapper'
] as const);

export type GeminiDiagnosticCode =
	| 'provider_ok'
	| GeminiFailure['code']
	| 'provider_response_invalid'
	| 'provider_transport_failed'
	| 'provider_not_configured'
	| 'diagnostic_forbidden'
	| 'diagnostic_bad_request'
	| 'wrapper_response_invalid'
	| 'wrapper_http_failed';

export type GeminiDiagnosticCategory =
	(typeof DIAGNOSTIC_CATEGORIES)[number];

export type GeminiDiagnosticResult = Readonly<{
	httpStatus: number | null;
	category: GeminiDiagnosticCategory;
	code: GeminiDiagnosticCode;
	success: boolean;
}>;

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isExactDiagnosticBody(value: unknown, diagnostic: string): boolean {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return hasExactKeys(record, ['diagnostic']) && record.diagnostic === diagnostic;
}

export function isGeminiDiagnosticRequest(value: unknown): boolean {
	return isExactDiagnosticBody(value, GEMINI_DIAGNOSTIC_BODY.diagnostic);
}

export function isOcrBoundaryProbeRequest(value: unknown): boolean {
	return isExactDiagnosticBody(value, OCR_BOUNDARY_PROBE_BODY.diagnostic);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split('.');
	if (parts.length !== 3 || parts[1]!.length === 0) return null;
	try {
		const encoded = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
		const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
		const binary = atob(padded);
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		const payload = JSON.parse(new TextDecoder().decode(bytes));
		return payload && typeof payload === 'object' && !Array.isArray(payload)
			? (payload as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * The Supabase gateway verifies the JWT signature before invoking a function.
 * This second check prevents temporary diagnostics from reaching Gemini unless
 * the verified token explicitly carries the service_role claim.
 */
export function hasServiceRoleClaim(authorization: string | null): boolean {
	if (!authorization?.startsWith('Bearer ')) return false;
	const token = authorization.slice('Bearer '.length).trim();
	const payload = decodeJwtPayload(token);
	return payload?.role === 'service_role';
}

export function createGeminiDiagnosticResult(input: {
	status: 'pass' | 'fail';
	category: GeminiDiagnosticCategory;
	code: GeminiDiagnosticCode;
	httpStatus: number | null;
}): GeminiDiagnosticResult {
	const candidateStatus = input.httpStatus;
	const httpStatus =
		typeof candidateStatus === 'number' &&
		Number.isInteger(candidateStatus) &&
		candidateStatus >= 100 &&
		candidateStatus <= 599
			? candidateStatus
			: null;
	const code = DIAGNOSTIC_CODES.includes(input.code as (typeof DIAGNOSTIC_CODES)[number])
		? input.code
		: 'provider_transport_failed';
	const category = DIAGNOSTIC_CATEGORIES.includes(
		input.category as (typeof DIAGNOSTIC_CATEGORIES)[number]
	)
		? input.category
		: 'transport';
	return Object.freeze({
		httpStatus,
		category,
		code,
		success: input.status === 'pass'
	});
}

export function parseGeminiDiagnosticResult(
	value: unknown
): GeminiDiagnosticResult | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (!hasExactKeys(record, ['httpStatus', 'category', 'code', 'success'])) return null;
	if (
		record.httpStatus !== null &&
		(typeof record.httpStatus !== 'number' ||
			!Number.isInteger(record.httpStatus) ||
			record.httpStatus < 100 ||
			record.httpStatus > 599)
	) {
		return null;
	}
	if (
		typeof record.category !== 'string' ||
		!DIAGNOSTIC_CATEGORIES.includes(
			record.category as (typeof DIAGNOSTIC_CATEGORIES)[number]
		) ||
		typeof record.code !== 'string' ||
		!DIAGNOSTIC_CODES.includes(record.code as (typeof DIAGNOSTIC_CODES)[number]) ||
		typeof record.success !== 'boolean'
	) {
		return null;
	}
	return Object.freeze({
		httpStatus: record.httpStatus as number | null,
		category: record.category as GeminiDiagnosticCategory,
		code: record.code as GeminiDiagnosticCode,
		success: record.success
	});
}

export function classifyGeminiDiagnosticFailure(error: unknown): GeminiDiagnosticResult {
	if (error instanceof GeminiHttpError) {
		const failure = classifyGeminiFailure(error.status, error.responseBody);
		return createGeminiDiagnosticResult({
			status: 'fail',
			category: 'provider',
			code: failure.code,
			httpStatus: error.status
		});
	}
	if (error instanceof GeminiResponseError) {
		return createGeminiDiagnosticResult({
			status: 'fail',
			category: 'provider',
			code: 'provider_response_invalid',
			httpStatus: 200
		});
	}
	if (error instanceof GeminiTransportError || error instanceof DOMException) {
		return createGeminiDiagnosticResult({
			status: 'fail',
			category: 'transport',
			code: 'provider_transport_failed',
			httpStatus: null
		});
	}
	return createGeminiDiagnosticResult({
		status: 'fail',
		category: 'transport',
		code: 'provider_transport_failed',
		httpStatus: null
	});
}

export function decodeGeminiDiagnosticFixture(): Uint8Array {
	const binary = atob(GEMINI_DIAGNOSTIC_FIXTURE_BASE64);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
