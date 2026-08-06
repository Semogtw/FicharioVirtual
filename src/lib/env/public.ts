import { z } from 'zod';

const optionalGoogleClientId = z
	.string()
	.trim()
	.min(20)
	.max(512)
	.regex(/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/)
	.optional()
	.transform((value) => value ?? null);
const optionalPickerKey = z
	.string()
	.trim()
	.min(20)
	.max(256)
	.regex(/^AIza[A-Za-z0-9_-]+$/)
	.optional()
	.transform((value) => value ?? null);
const optionalProjectNumber = z
	.string()
	.trim()
	.regex(/^\d{6,20}$/)
	.optional()
	.transform((value) => value ?? null);

const publicEnvSchema = z
	.object({
		PUBLIC_SUPABASE_URL: z.url(),
		PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(20).max(512),
		PUBLIC_GOOGLE_CLIENT_ID: optionalGoogleClientId,
		PUBLIC_GOOGLE_PICKER_API_KEY: optionalPickerKey,
		PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: optionalProjectNumber
	})
	.refine(
		(value) => {
			const pickerValues = [
				value.PUBLIC_GOOGLE_CLIENT_ID,
				value.PUBLIC_GOOGLE_PICKER_API_KEY,
				value.PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
			];
			return pickerValues.every((item) => item === null) || pickerValues.every((item) => item !== null);
		},
		{ message: 'Google Picker settings must be configured together' }
	);

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
	const result = publicEnvSchema.safeParse({
		PUBLIC_SUPABASE_URL: source.PUBLIC_SUPABASE_URL,
		PUBLIC_SUPABASE_PUBLISHABLE_KEY: source.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
		PUBLIC_GOOGLE_CLIENT_ID: source.PUBLIC_GOOGLE_CLIENT_ID || undefined,
		PUBLIC_GOOGLE_PICKER_API_KEY: source.PUBLIC_GOOGLE_PICKER_API_KEY || undefined,
		PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER:
			source.PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER || undefined
	});

	if (!result.success) {
		const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))]
			.filter(Boolean)
			.join(', ');
		throw new Error(`Invalid public environment${fields ? `: ${fields}` : ''}`);
	}

	return Object.freeze(result.data);
}
