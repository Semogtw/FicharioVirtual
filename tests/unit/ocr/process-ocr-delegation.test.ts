import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../supabase/functions/process-ocr/index.ts', import.meta.url),
	'utf8'
);

describe('process-ocr provider delegation', () => {
	it('delegates the Gemini request and structured response parsing to the shared client', () => {
		expect(source).toContain('requestGeminiOcr');
		expect(source).toContain('GeminiHttpError');
		expect(source).toContain('GeminiResponseError');
		expect(source).toContain('GeminiTransportError');
	});

	it('does not duplicate the provider endpoint, prompt schema or payload parser', () => {
		expect(source).not.toContain('generativelanguage.googleapis.com');
		expect(source).not.toContain('const responseSchema');
		expect(source).not.toContain('function base64');
		expect(source).not.toContain('function responseText');
		expect(source).not.toContain('parseOcrPayload');
	});
});
