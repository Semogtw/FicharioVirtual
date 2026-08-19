import { describe, expect, it } from 'vitest';
import {
	resolveCurrentProviderPolicy,
	type ProviderProfileRpcClient
} from '../../../supabase/functions/_shared/provider-profile-resolver';

function client(
	data: unknown,
	error: { message?: string } | null = null
): ProviderProfileRpcClient {
	return {
		async rpc(functionName) {
			expect(functionName).toBe('current_provider_profile');
			return { data, error };
		}
	};
}

describe('current provider policy resolver', () => {
	it('resolves the owner route from the authenticated database profile', async () => {
		await expect(resolveCurrentProviderPolicy(client('owner'))).resolves.toEqual({
			profile: 'owner',
			ocrRoute: 'owner_gemini',
			geminiAllowed: true,
			desktopOcrAllowed: true
		});
	});

	it('resolves public without exposing Gemini or desktop OCR', async () => {
		await expect(resolveCurrentProviderPolicy(client('public'))).resolves.toEqual({
			profile: 'public',
			ocrRoute: 'public_azure',
			geminiAllowed: false,
			desktopOcrAllowed: false
		});
	});

	it('fails closed for null, malformed values and RPC failures', async () => {
		await expect(resolveCurrentProviderPolicy(client(null))).resolves.toBeNull();
		await expect(resolveCurrentProviderPolicy(client('admin'))).resolves.toBeNull();
		await expect(
			resolveCurrentProviderPolicy(client(null, { message: 'internal database detail' }))
		).resolves.toBeNull();
	});

	it('fails closed when the RPC transport throws', async () => {
		const throwingClient: ProviderProfileRpcClient = {
			async rpc() {
				throw new Error('transport detail');
			}
		};

		await expect(resolveCurrentProviderPolicy(throwingClient)).resolves.toBeNull();
	});
});
