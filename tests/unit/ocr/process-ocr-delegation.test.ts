import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../supabase/functions/process-ocr/index.ts', import.meta.url),
	'utf8'
);

describe('process-ocr provider delegation', () => {
	it('delegates the Gemini request and structured response parsing to the shared client', () => {
		expect(source).toContain('requestGeminiOcr');
		expect(source).toContain('planOcrFailure');
	});

	it('does not duplicate the provider endpoint, prompt schema or payload parser', () => {
		expect(source).not.toContain('generativelanguage.googleapis.com');
		expect(source).not.toContain('const responseSchema');
		expect(source).not.toContain('function base64');
		expect(source).not.toContain('function responseText');
		expect(source).not.toContain('parseOcrPayload');
	});

	it('delegates persistence and HTTP decisions to the shared failure planner', () => {
		expect(source).toContain("from '../_shared/ocr-failure.ts'");
		expect(source).toContain('planOcrFailure');
		expect(source).not.toContain('classifyGeminiFailure');
		expect(source).not.toContain('geminiFailureResponse');
		expect(source).not.toContain(
			"const code = responseInvalid ? 'ocr_response_invalid' : 'ocr_request_failed'"
		);
	});
});
