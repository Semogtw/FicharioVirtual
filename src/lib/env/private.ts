import { z } from 'zod';

const privateEnvSchema = z.object({
	GEMINI_API_KEY: z.string().trim().min(20).max(512),
	OCR_MODEL_PRIMARY: z.string().trim().min(3).max(128),
	OCR_MODEL_QUALITY: z.string().trim().min(3).max(128).optional(),
	OCR_PROMPT_VERSION: z.coerce.number().int().positive().max(10_000),
	OCR_DAILY_HARD_LIMIT: z.coerce.number().int().positive().max(10_000)
});

export type PrivateEnv = z.infer<typeof privateEnvSchema>;

/**
 * Parses secrets supplied by a trusted backend runtime. This module must not be
 * imported by browser-facing code.
 */
export function parsePrivateEnv(source: Record<string, string | undefined>): PrivateEnv {
	const result = privateEnvSchema.safeParse({
		GEMINI_API_KEY: source.GEMINI_API_KEY,
		OCR_MODEL_PRIMARY: source.OCR_MODEL_PRIMARY,
		OCR_MODEL_QUALITY: source.OCR_MODEL_QUALITY || undefined,
		OCR_PROMPT_VERSION: source.OCR_PROMPT_VERSION,
		OCR_DAILY_HARD_LIMIT: source.OCR_DAILY_HARD_LIMIT
	});

	if (!result.success) {
		const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))]
			.filter(Boolean)
			.join(', ');
		throw new Error(`Invalid private environment${fields ? `: ${fields}` : ''}`);
	}

	return Object.freeze(result.data);
}
