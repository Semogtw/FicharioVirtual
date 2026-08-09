import { classifyGeminiFailure, type GeminiFailure } from './ocr-contract.ts';
import { GeminiHttpError, GeminiResponseError } from './gemini-ocr-client.ts';

export const GEMINI_DIAGNOSTIC_BODY = Object.freeze({
	diagnostic: 'gemini-provider-v1'
});

export const GEMINI_DIAGNOSTIC_PAGE = Object.freeze({
	pageId: '33333333-3333-4333-8333-333333333333',
	pageNumber: 1,
	mimeType: 'image/png'
});

export function isGeminiDiagnosticRequest(value: unknown): boolean {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		Object.keys(record).length === 1 && record.diagnostic === GEMINI_DIAGNOSTIC_BODY.diagnostic
	);
}

// A deterministic 1x1 PNG. It contains no user data and is never accepted from
// callers. The staging script uses the same literal fixture.
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
	'diagnostic_bad_request'
]);

export type GeminiDiagnosticCode =
	| 'provider_ok'
	| GeminiFailure['code']
	| 'provider_response_invalid'
	| 'provider_transport_failed'
	| 'provider_not_configured'
	| 'diagnostic_forbidden'
	| 'diagnostic_bad_request';

export type GeminiDiagnosticCategory =
	'provider' | 'transport' | 'configuration' | 'authorization' | 'request';

export type GeminiDiagnosticResult = Readonly<{
	schemaVersion: 1;
	status: 'pass' | 'fail';
	category: GeminiDiagnosticCategory;
	code: GeminiDiagnosticCode;
	httpStatus: number | null;
}>;

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
 * This second check prevents the temporary route from entering the provider
 * path unless the verified token explicitly carries the service_role claim.
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
	const code = DIAGNOSTIC_CODES.includes(input.code) ? input.code : 'provider_transport_failed';
	return Object.freeze({
		schemaVersion: 1 as const,
		status: input.status === 'pass' ? 'pass' : 'fail',
		category: input.category,
		code,
		httpStatus
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
