import { z } from 'zod';

const privateEnvSchema = z.object({
	GEMINI_API_KEY: z.string().trim().min(20).max(512),
	OCR_MODEL_PRIMARY: z.string().trim().min(3).max(128),
	OCR_MODEL_FALLBACK: z.string().trim().min(3).max(128).optional(),
	OCR_MODEL_QUALITY: z.string().trim().min(3).max(128).optional(),
	OCR_PROMPT_VERSION: z.coerce.number().int().positive().max(10_000),
	OCR_MODEL_PRIMARY_RPM: z.coerce.number().int().min(1).max(60).optional(),
	OCR_MODEL_FALLBACK_RPM: z.coerce.number().int().min(1).max(60).optional(),
	OCR_PROVIDER_MAX_QUEUE_WAIT_MS: z.coerce.number().int().min(0).max(60_000).optional(),
	OCR_BATCH_MAX_PAGES: z.coerce.number().int().min(1).max(100).optional(),
	OCR_BATCH_MAX_BYTES: z.coerce
		.number()
		.int()
		.min(1024 * 1024)
		.max(14 * 1024 * 1024)
		.optional(),
	OCR_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(140_000).optional()
});

export type PrivateEnv = z.infer<typeof privateEnvSchema>;

/**
 * Parses secrets supplied by a trusted backend runtime. This module must not be
 * imported by browser-facing code. Unknown keys are deliberately ignored so
 * obsolete deployment variables cannot regain authority over provider use.
 */
export function parsePrivateEnv(source: Record<string, string | undefined>): PrivateEnv {
	const result = privateEnvSchema.safeParse({
		GEMINI_API_KEY: source.GEMINI_API_KEY,
		OCR_MODEL_PRIMARY: source.OCR_MODEL_PRIMARY,
		OCR_MODEL_FALLBACK: source.OCR_MODEL_FALLBACK || undefined,
		OCR_MODEL_QUALITY: source.OCR_MODEL_QUALITY || undefined,
		OCR_PROMPT_VERSION: source.OCR_PROMPT_VERSION,
		OCR_MODEL_PRIMARY_RPM: source.OCR_MODEL_PRIMARY_RPM || undefined,
		OCR_MODEL_FALLBACK_RPM: source.OCR_MODEL_FALLBACK_RPM || undefined,
		OCR_PROVIDER_MAX_QUEUE_WAIT_MS: source.OCR_PROVIDER_MAX_QUEUE_WAIT_MS || undefined,
		OCR_BATCH_MAX_PAGES: source.OCR_BATCH_MAX_PAGES || undefined,
		OCR_BATCH_MAX_BYTES: source.OCR_BATCH_MAX_BYTES || undefined,
		OCR_REQUEST_TIMEOUT_MS: source.OCR_REQUEST_TIMEOUT_MS || undefined
	});

	if (!result.success) {
		const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))]
			.filter(Boolean)
			.join(', ');
		throw new Error(`Invalid private environment${fields ? `: ${fields}` : ''}`);
	}

	return Object.freeze(result.data);
}
