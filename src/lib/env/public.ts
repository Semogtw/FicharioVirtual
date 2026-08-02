import { z } from 'zod';

const publicEnvSchema = z.object({
	PUBLIC_SUPABASE_URL: z.url(),
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(20).max(512)
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
	const result = publicEnvSchema.safeParse({
		PUBLIC_SUPABASE_URL: source.PUBLIC_SUPABASE_URL,
		PUBLIC_SUPABASE_PUBLISHABLE_KEY: source.PUBLIC_SUPABASE_PUBLISHABLE_KEY
	});

	if (!result.success) {
		const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))]
			.filter(Boolean)
			.join(', ');
		throw new Error(`Invalid public environment${fields ? `: ${fields}` : ''}`);
	}

	return Object.freeze(result.data);
}
