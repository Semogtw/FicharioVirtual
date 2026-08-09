import { describe, expect, it } from 'vitest';
import {
	GeminiHttpError,
	GeminiResponseError
} from '../../../supabase/functions/_shared/gemini-ocr-client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
	classifyGeminiDiagnosticFailure,
	createGeminiDiagnosticResult,
	decodeGeminiDiagnosticFixture,
	GEMINI_DIAGNOSTIC_BODY,
	GEMINI_DIAGNOSTIC_FIXTURE_BASE64,
	hasServiceRoleClaim,
	isGeminiDiagnosticRequest
} from '../../../supabase/functions/_shared/gemini-diagnostic-contract';

function token(payload: Record<string, unknown>) {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('temporary Gemini boundary diagnostic contract', () => {
	it('accepts only a verified-gateway bearer token carrying service_role', () => {
		expect(hasServiceRoleClaim(null)).toBe(false);
		expect(hasServiceRoleClaim('Basic service_role')).toBe(false);
		expect(hasServiceRoleClaim(`Bearer ${token({ role: 'authenticated' })}`)).toBe(false);
		expect(hasServiceRoleClaim(`Bearer ${token({ role: 'service_role' })}`)).toBe(true);
		expect(
			hasServiceRoleClaim(`Bearer ${token({ role: 'service_role', secret: 'do-not-log' })}`)
		).toBe(true);
	});

	it('requires the exact diagnostic body and decodes a fixed PNG fixture', () => {
		expect(isGeminiDiagnosticRequest(GEMINI_DIAGNOSTIC_BODY)).toBe(true);
		expect(isGeminiDiagnosticRequest({ ...GEMINI_DIAGNOSTIC_BODY, extra: 'nope' })).toBe(false);
		expect(isGeminiDiagnosticRequest({ diagnostic: 'other' })).toBe(false);
		expect(Array.from(decodeGeminiDiagnosticFixture().slice(0, 8))).toEqual([
			137, 80, 78, 71, 13, 10, 26, 10
		]);
		const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
		expect(digest(decodeGeminiDiagnosticFixture())).toBe(
			'431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460'
		);
		expect(readFileSync('tools/checks/check-gemini-boundary-staging.mjs', 'utf8')).toContain(
			GEMINI_DIAGNOSTIC_FIXTURE_BASE64
		);
	});

	it('classifies provider failures without returning provider body or credentials', () => {
		const result = classifyGeminiDiagnosticFailure(
			new GeminiHttpError(400, 'secret body https://provider.invalid key=AIza-not-output')
		);
		expect(result).toEqual({
			schemaVersion: 1,
			status: 'fail',
			category: 'provider',
			code: 'gemini_invalid_request',
			httpStatus: 400
		});
		expect(JSON.stringify(result)).not.toMatch(/secret|provider\.invalid|AIza/);

		expect(classifyGeminiDiagnosticFailure(new GeminiResponseError())).toEqual({
			schemaVersion: 1,
			status: 'fail',
			category: 'provider',
			code: 'provider_response_invalid',
			httpStatus: 200
		});
		expect(
			classifyGeminiDiagnosticFailure(new Error('raw prompt and Authorization: Bearer secret'))
		).toEqual({
			schemaVersion: 1,
			status: 'fail',
			category: 'transport',
			code: 'provider_transport_failed',
			httpStatus: null
		});
	});

	it('falls back to an allowlisted code and bounded status', () => {
		expect(
			createGeminiDiagnosticResult({
				status: 'fail',
				category: 'transport',
				code: 'not-allowlisted' as never,
				httpStatus: 999
			})
		).toEqual({
			schemaVersion: 1,
			status: 'fail',
			category: 'transport',
			code: 'provider_transport_failed',
			httpStatus: null
		});
	});
});
