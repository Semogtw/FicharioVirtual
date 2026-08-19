import { describe, expect, it } from 'vitest';
import {
	loadAuthorizedSession,
	signIn,
	signOut,
	signUp,
	type AuthClientLike
} from '../../../src/lib/services/auth';

function clientFixture({
	active = true,
	sessionPresent = true,
	enrollmentProfile = active ? 'owner' : null,
	signUpSessionPresent = sessionPresent
}: {
	active?: boolean;
	sessionPresent?: boolean;
	enrollmentProfile?: 'owner' | 'public' | null;
	signUpSessionPresent?: boolean;
} = {}) {
	let signedOut = 0;
	let lastSignOutScope: string | null = null;
	let credentials: { email: string; password: string } | null = null;
	let signUpCredentials: { email: string; password: string } | null = null;
	let enrollmentCalls = 0;
	const session = sessionPresent
		? ({ user: { id: '11111111-1111-4111-8111-111111111111' } } as never)
		: null;
	const signUpSession = signUpSessionPresent
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
			async signUp(input) {
				signUpCredentials = input;
				return { data: { session: signUpSession }, error: null };
			},
			async signOut(options) {
				signedOut += 1;
				lastSignOutScope = options?.scope ?? null;
				return { error: null };
			}
		},
		async rpc(functionName) {
			expect(functionName).toBe('ensure_current_app_user');
			enrollmentCalls += 1;
			return { data: enrollmentProfile, error: null };
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
		get lastSignOutScope() {
			return lastSignOutScope;
		},
		get credentials() {
			return credentials;
		},
		get signUpCredentials() {
			return signUpCredentials;
		},
		get enrollmentCalls() {
			return enrollmentCalls;
		}
	};
}

describe('authorized session loading', () => {
	it('returns the current session when the app row is active', async () => {
		const fixture = clientFixture();
		const session = await loadAuthorizedSession(fixture.client);

		expect(session?.user.id).toBe('11111111-1111-4111-8111-111111111111');
		expect(fixture.enrollmentCalls).toBe(1);
		expect(fixture.signedOut).toBe(0);
	});

	it('globally signs out a session that remains inactive after enrollment', async () => {
		const fixture = clientFixture({ active: false });

		await expect(loadAuthorizedSession(fixture.client)).resolves.toBeNull();
		expect(fixture.signedOut).toBe(1);
		expect(fixture.lastSignOutScope).toBe('global');
	});

	it('shares concurrent active-row checks during overlapping startup authorization', async () => {
		let queryCount = 0;
		let resolveQuery!: (value: { data: unknown; error: null }) => void;
		const queryResult = new Promise<{ data: unknown; error: null }>((resolve) => {
			resolveQuery = resolve;
		});
		const session = {
			user: { id: '11111111-1111-4111-8111-111111111111' }
		} as never;
		const query = {
			select() {
				return this;
			},
			eq() {
				return this;
			},
			async maybeSingle() {
				queryCount += 1;
				return queryResult;
			}
		};
		const client: AuthClientLike = {
			auth: {
				async getSession() {
					return { data: { session }, error: null };
				},
				async signInWithPassword() {
					return { data: { session }, error: null };
				},
				async signUp() {
					return { data: { session }, error: null };
				},
				async signOut() {
					return { error: null };
				}
			},
			async rpc() {
				return { data: 'owner', error: null };
			},
			from() {
				return query;
			}
		};

		const first = loadAuthorizedSession(client);
		const second = loadAuthorizedSession(client);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(queryCount).toBe(1);
		resolveQuery({ data: { is_active: true }, error: null });
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
	});
});

describe('password sign in', () => {
	it('normalizes the email, enrolls the account and verifies authorization', async () => {
		const fixture = clientFixture();
		await signIn('  OWNER@EXAMPLE.TEST ', 'correct horse battery staple', fixture.client);

		expect(fixture.credentials).toEqual({
			email: 'owner@example.test',
			password: 'correct horse battery staple'
		});
		expect(fixture.enrollmentCalls).toBe(1);
	});

	it('rejects a valid Supabase session that remains inactive for the app', async () => {
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

describe('public sign up', () => {
	it('normalizes credentials and enrolls immediately when Supabase returns a session', async () => {
		const fixture = clientFixture({ enrollmentProfile: 'public' });
		const result = await signUp('  NEW.USER@EXAMPLE.TEST ', 'public-password', fixture.client);

		expect(fixture.signUpCredentials).toEqual({
			email: 'new.user@example.test',
			password: 'public-password'
		});
		expect(result.confirmationRequired).toBe(false);
		expect(result.session?.user.id).toBe('11111111-1111-4111-8111-111111111111');
		expect(fixture.enrollmentCalls).toBe(1);
	});

	it('supports email-confirmation mode without pretending a session exists', async () => {
		const fixture = clientFixture({ signUpSessionPresent: false, enrollmentProfile: 'public' });
		const result = await signUp('new.user@example.test', 'public-password', fixture.client);

		expect(result).toEqual({ session: null, confirmationRequired: true });
		expect(fixture.enrollmentCalls).toBe(0);
	});

	it('rejects weak registration passwords locally', async () => {
		const fixture = clientFixture();
		await expect(signUp('new.user@example.test', 'short', fixture.client)).rejects.toEqual(
			expect.objectContaining({ code: 'weak_password' })
		);
		expect(fixture.signUpCredentials).toBeNull();
	});
});

describe('explicit sign out', () => {
	it('only closes the current browser session', async () => {
		const fixture = clientFixture();

		await signOut(fixture.client);

		expect(fixture.signedOut).toBe(1);
		expect(fixture.lastSignOutScope).toBe('local');
	});
});
