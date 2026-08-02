import { describe, expect, it } from 'vitest';
import {
	assertAuthorizedAccount,
	assertProbeIsolation,
	assertUnauthorizedAccount
} from '../../../tools/checks/supabase-staging-contract.mjs';

const authorizedUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unauthorizedUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const probeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Supabase staging contract', () => {
	it('accepts an active allowlisted account bound to the authenticated user', () => {
		expect(() =>
			assertAuthorizedAccount({
				userId: authorizedUserId,
				authorized: true,
				appUser: { user_id: authorizedUserId, is_active: true }
			})
		).not.toThrow();
		expect(() =>
			assertAuthorizedAccount({
				userId: authorizedUserId,
				authorized: true,
				appUser: { user_id: unauthorizedUserId, is_active: true }
			})
		).toThrow(/authenticated user/);
	});

	it('requires the second account to remain outside the active allowlist', () => {
		expect(() =>
			assertUnauthorizedAccount({
				userId: unauthorizedUserId,
				authorized: false,
				appUser: null
			})
		).not.toThrow();
		expect(() =>
			assertUnauthorizedAccount({
				userId: unauthorizedUserId,
				authorized: true,
				appUser: { user_id: unauthorizedUserId, is_active: true }
			})
		).toThrow(/allowlist/);
	});

	it('requires the owner to see the probe while the second account sees nothing', () => {
		expect(() =>
			assertProbeIsolation({
				probeId,
				ownerUserId: authorizedUserId,
				ownerRows: [{ id: probeId, user_id: authorizedUserId }],
				outsiderRows: []
			})
		).not.toThrow();
		expect(() =>
			assertProbeIsolation({
				probeId,
				ownerUserId: authorizedUserId,
				ownerRows: [{ id: probeId, user_id: authorizedUserId }],
				outsiderRows: [{ id: probeId, user_id: authorizedUserId }]
			})
		).toThrow(/second account/);
	});
});
