import { describe, expect, it } from 'vitest';
import {
	loadAuthorizedSession,
	signIn,
	signOut,
	type AuthClientLike
} from '../../../src/lib/services/auth';

const session = {
	user: { id: '11111111-1111-4111-8111-111111111111' }
} as never;

function unavailable() {
	return expect.objectContaining({
		name: 'AuthServiceError',
		code: 'auth_unavailable',
		message: 'Não foi possível confirmar o acesso agora. Tente novamente.'
	});
}

function client(
	overrides: Partial<AuthClientLike['auth']> = {},
	allowlistData: unknown = { is_active: true }
): AuthClientLike {
	const query = {
		select() {
			return this;
		},
		eq() {
			return this;
		},
		async maybeSingle() {
			return { data: allowlistData as { is_active: boolean } | null, error: null };
		}
	};
	return {
		auth: {
			async getSession() {
				return { data: { session }, error: null };
			},
			async signInWithPassword() {
				return { data: { session }, error: null };
			},
			async signOut() {
				return { error: null };
			},
			...overrides
		},
		from() {
			return query;
		}
	};
}

describe('auth service failure boundary', () => {
	it('normalizes thrown transport failures from session loading, sign-in and sign-out', async () => {
		await expect(
			loadAuthorizedSession(
				client({
					async getSession() {
						throw new Error('internal auth host');
					}
				})
			)
		).rejects.toEqual(unavailable());

		await expect(
			signIn(
				'owner@example.test',
				'password',
				client({
					async signInWithPassword() {
						throw new Error('socket reset');
					}
				})
			)
		).rejects.toEqual(unavailable());

		await expect(
			signOut(
				client({
					async signOut() {
						throw new Error('logout transport details');
					}
				})
			)
		).rejects.toEqual(unavailable());
	});

	it('fails closed when the allowlist response violates its exact contract', async () => {
		await expect(loadAuthorizedSession(client({}, { is_active: 'yes' }))).rejects.toEqual(
			unavailable()
		);
		await expect(
			loadAuthorizedSession(client({}, { is_active: true, role: 'owner' }))
		).rejects.toEqual(unavailable());
	});

	it('normalizes allowlist and unauthorized-session sign-out transport failures', async () => {
		const allowlistFailure = client();
		allowlistFailure.from = () => {
			throw new Error('postgrest internals');
		};
		await expect(loadAuthorizedSession(allowlistFailure)).rejects.toEqual(unavailable());

		await expect(
			loadAuthorizedSession(
				client(
					{
						async signOut() {
							throw new Error('cannot close unauthorized session');
						}
					},
					null
				)
			)
		).rejects.toEqual(unavailable());
	});
});
