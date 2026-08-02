import { describe, expect, it } from 'vitest';
import { loadAuthorizedSession, signIn, type AuthClientLike } from '../../../src/lib/services/auth';

function clientFixture({ active = true, sessionPresent = true } = {}) {
	let signedOut = 0;
	let credentials: { email: string; password: string } | null = null;
	const session = sessionPresent
		? ({ user: { id: '11111111-1111-4111-8111-111111111111' } } as never)
		: null;

	const query = {
		select() {
			return this;
		},
		eq() {
			return this;
		},
		async maybeSingle() {
			return { data: active ? { is_active: true } : null, error: null };
		}
	};

	const client: AuthClientLike = {
		auth: {
			async getSession() {
				return { data: { session }, error: null };
			},
			async signInWithPassword(input) {
				credentials = input;
				return { data: { session }, error: null };
			},
			async signOut() {
				signedOut += 1;
				return { error: null };
			}
		},
		from() {
			return query;
		}
	};

	return {
		client,
		get signedOut() {
			return signedOut;
		},
		get credentials() {
			return credentials;
		}
	};
}

describe('authorized session loading', () => {
	it('returns the current session when the allowlist row is active', async () => {
		const fixture = clientFixture();
		const session = await loadAuthorizedSession(fixture.client);

		expect(session?.user.id).toBe('11111111-1111-4111-8111-111111111111');
		expect(fixture.signedOut).toBe(0);
	});

	it('signs out a session that is missing from the active allowlist', async () => {
		const fixture = clientFixture({ active: false });

		await expect(loadAuthorizedSession(fixture.client)).resolves.toBeNull();
		expect(fixture.signedOut).toBe(1);
	});
});

describe('password sign in', () => {
	it('normalizes the email and verifies authorization before returning', async () => {
		const fixture = clientFixture();
		await signIn('  OWNER@EXAMPLE.TEST ', 'correct horse battery staple', fixture.client);

		expect(fixture.credentials).toEqual({
			email: 'owner@example.test',
			password: 'correct horse battery staple'
		});
	});

	it('rejects a valid Supabase session that is not authorized for the app', async () => {
		const fixture = clientFixture({ active: false });

		await expect(signIn('owner@example.test', 'password', fixture.client)).rejects.toEqual(
			expect.objectContaining({ code: 'not_authorized' })
		);
	});

	it('validates credentials before constructing the default Supabase client', async () => {
		await expect(signIn('invalid', 'password')).rejects.toEqual(
			expect.objectContaining({ code: 'invalid_input' })
		);
		await expect(signIn('owner@example.test', '')).rejects.toEqual(
			expect.objectContaining({ code: 'invalid_input' })
		);
	});
});
