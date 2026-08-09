import { describe, expect, it } from 'vitest';
import { parsePrivateEnv } from '../../src/lib/env/private';

const required = {
	GEMINI_API_KEY: 'example_private_key_1234567890',
	OCR_MODEL_PRIMARY: 'gemini-test',
	OCR_PROMPT_VERSION: '1'
};

describe('private OCR environment', () => {
	it('does not require or expose an application-created daily limit', () => {
		expect(
			parsePrivateEnv({
				...required,
				OCR_DAILY_HARD_LIMIT: '1'
			})
		).toEqual({
			GEMINI_API_KEY: required.GEMINI_API_KEY,
			OCR_MODEL_PRIMARY: required.OCR_MODEL_PRIMARY,
			OCR_MODEL_QUALITY: undefined,
			OCR_PROMPT_VERSION: 1,
			OCR_BATCH_MAX_PAGES: undefined,
			OCR_BATCH_MAX_BYTES: undefined,
			OCR_REQUEST_TIMEOUT_MS: undefined
		});
	});

	it('accepts only bounded technical batch controls', () => {
		expect(
			parsePrivateEnv({
				...required,
				OCR_MODEL_QUALITY: 'gemini-quality',
				OCR_BATCH_MAX_PAGES: '32',
				OCR_BATCH_MAX_BYTES: String(10 * 1024 * 1024),
				OCR_REQUEST_TIMEOUT_MS: '90000'
			})
		).toEqual({
			GEMINI_API_KEY: required.GEMINI_API_KEY,
			OCR_MODEL_PRIMARY: required.OCR_MODEL_PRIMARY,
			OCR_MODEL_QUALITY: 'gemini-quality',
			OCR_PROMPT_VERSION: 1,
			OCR_BATCH_MAX_PAGES: 32,
			OCR_BATCH_MAX_BYTES: 10 * 1024 * 1024,
			OCR_REQUEST_TIMEOUT_MS: 90000
		});
	});

	it('rejects controls that exceed the Edge Function and Gemini inline safety envelope', () => {
		expect(() => parsePrivateEnv({ ...required, OCR_BATCH_MAX_PAGES: '101' })).toThrow(
			'Invalid private environment'
		);
		expect(() => parsePrivateEnv({ ...required, OCR_BATCH_MAX_BYTES: '1024' })).toThrow(
			'Invalid private environment'
		);
		expect(() =>
			parsePrivateEnv({ ...required, OCR_BATCH_MAX_BYTES: String(15 * 1024 * 1024) })
		).toThrow('Invalid private environment');
		expect(() => parsePrivateEnv({ ...required, OCR_REQUEST_TIMEOUT_MS: '5000' })).toThrow(
			'Invalid private environment'
		);
	});
});
