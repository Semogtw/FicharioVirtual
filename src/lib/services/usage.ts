import { z } from 'zod';
import { isIsoDate, isIsoTimestamp } from '$lib/validation/iso-timestamp';
import { getSupabaseClient } from './supabase';

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const average = z.number().nonnegative().max(1_000);
const day = z
	.object({
		date: z.string().refine(isIsoDate),
		ocrPages: counter,
		ocrBatches: counter,
		ocrCalls: counter,
		ocrAttempts: counter,
		averageBatchSize: average,
		quotaErrors: counter
	})
	.strict();
const usageOverviewSchema = z
	.object({
		generatedAt: z.string().refine(isIsoTimestamp),
		today: day,
		totals: z
			.object({
				notebooks: counter,
				documents: counter,
				pages: counter,
				pendingPages: counter,
				blockedQuotaPages: counter,
				reviewPages: counter,
				failedPages: counter,
				manualReviews: counter
			})
			.strict(),
		daily: z.array(day).max(30)
	})
	.strict();

export type UsageOverview = z.infer<typeof usageOverviewSchema>;

export type UsageClientLike = {
	rpc(name: 'get_usage_overview'): Promise<{ data: unknown; error: unknown }>;
};

export class UsageServiceError extends Error {
	constructor() {
		super('Não foi possível carregar o uso operacional agora.');
		this.name = 'UsageServiceError';
	}
}

function defaultClient(): UsageClientLike {
	return getSupabaseClient() as unknown as UsageClientLike;
}

export function parseUsageOverview(value: unknown): UsageOverview {
	const result = usageOverviewSchema.safeParse(value);
	if (!result.success) throw new TypeError('Invalid usage overview');
	return Object.freeze(result.data);
}

export async function loadUsageOverview(
	client: UsageClientLike = defaultClient()
): Promise<UsageOverview> {
	try {
		const { data, error } = await client.rpc('get_usage_overview');
		if (error || data === null) throw new UsageServiceError();
		return parseUsageOverview(data);
	} catch {
		throw new UsageServiceError();
	}
}
