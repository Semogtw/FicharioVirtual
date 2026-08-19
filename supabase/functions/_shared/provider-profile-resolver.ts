import { parseProviderPolicy, type ProviderPolicy } from './provider-profile.ts';

type RpcError = Readonly<{ message?: string }>;

export type ProviderProfileRpcClient = Readonly<{
	rpc: (
		functionName: 'current_provider_profile'
	) => Promise<{ data: unknown; error: RpcError | null }>;
}>;

/**
 * Resolve the authenticated user's provider policy exclusively from the database.
 * The caller never supplies a user id, provider name or profile, and malformed or
 * unavailable data fails closed by returning null.
 */
export async function resolveCurrentProviderPolicy(
	client: ProviderProfileRpcClient
): Promise<ProviderPolicy | null> {
	try {
		const { data, error } = await client.rpc('current_provider_profile');
		if (error) return null;
		return parseProviderPolicy(data);
	} catch {
		return null;
	}
}
