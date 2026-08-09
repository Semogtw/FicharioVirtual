import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	GeminiHttpError,
	GeminiResponseError
} from '../../../supabase/functions/_shared/gemini-ocr-client';
import {
	classifyGeminiDiagnosticFailure,
	createGeminiDiagnosticResult,
	decodeGeminiDiagnosticFixture,
	GEMINI_DIAGNOSTIC_BODY,
	hasServiceRoleClaim,
	isGeminiDiagnosticRequest,
	OCR_BOUNDARY_PROBE_BODY,
	isOcrBoundaryProbeRequest,
	parseGeminiDiagnosticResult
} from '../../../supabase/functions/_shared/gemini-diagnostic-contract';

function token(payload: Record<string, unknown>) {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('temporary OCR boundary diagnostic contract', () => {
	it('accepts only a bearer JWT carrying service_role after the gateway verification boundary', () => {
		expect(hasServiceRoleClaim(null)).toBe(false);
		expect(hasServiceRoleClaim('Basic service_role')).toBe(false);
		expect(hasServiceRoleClaim(`Bearer ${token({ role: 'authenticated' })}`)).toBe(false);
		expect(hasServiceRoleClaim(`Bearer ${token({ role: 'service_role' })}`)).toBe(true);
		expect(hasServiceRoleClaim('Bearer malformed')).toBe(false);
	});

	it('requires exact diagnostic request shapes and a deterministic fixed PNG', () => {
		expect(isGeminiDiagnosticRequest(GEMINI_DIAGNOSTIC_BODY)).toBe(true);
		expect(isGeminiDiagnosticRequest({ ...GEMINI_DIAGNOSTIC_BODY, extra: true })).toBe(false);
		expect(isOcrBoundaryProbeRequest(OCR_BOUNDARY_PROBE_BODY)).toBe(true);
		expect(isOcrBoundaryProbeRequest({ ...OCR_BOUNDARY_PROBE_BODY, extra: true })).toBe(false);
		const bytes = decodeGeminiDiagnosticFixture();
		expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		expect(createHash('sha256').update(bytes).digest('hex')).toBe(
			'431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460'
		);
	});

	it('exposes exactly the four allowlisted public result fields', () => {
		const result = createGeminiDiagnosticResult({
			status: 'pass',
			category: 'provider',
			code: 'provider_ok',
			httpStatus: 200
		});
		expect(result).toEqual({
			httpStatus: 200,
			category: 'provider',
			code: 'provider_ok',
			success: true
		});
		expect(Object.keys(result).sort()).toEqual(['category', 'code', 'httpStatus', 'success']);
		expect(parseGeminiDiagnosticResult(result)).toEqual(result);
		expect(parseGeminiDiagnosticResult({ ...result, model: 'must-not-appear' })).toBeNull();
	});

	it('redacts provider body, credentials, prompt and model from classified failures', () => {
		const raw =
			'secret-body key=AIza-not-output Authorization: Bearer secret prompt=private model=private';
		const result = classifyGeminiDiagnosticFailure(new GeminiHttpError(400, raw));
		expect(result).toEqual({
			httpStatus: 400,
			category: 'provider',
			code: 'gemini_invalid_request',
			success: false
		});
		expect(JSON.stringify(result)).not.toMatch(/secret|AIza|Authorization|prompt|model|private/i);

		const malformed = classifyGeminiDiagnosticFailure(new GeminiResponseError());
		expect(malformed).toEqual({
			httpStatus: 200,
			category: 'provider',
			code: 'provider_response_invalid',
			success: false
		});
	});

	it('bounds statuses and falls back to allowlisted category/code values', () => {
		expect(
			createGeminiDiagnosticResult({
				status: 'fail',
				category: 'not-allowlisted' as never,
				code: 'not-allowlisted' as never,
				httpStatus: 999
			})
		).toEqual({
			httpStatus: null,
			category: 'transport',
			code: 'provider_transport_failed',
			success: false
		});
	});
});
