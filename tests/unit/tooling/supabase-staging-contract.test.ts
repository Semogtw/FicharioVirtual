import { describe, expect, it } from 'vitest';
import {
	assertAuthorizedAccount,
	assertDeniedStorageOperation,
	assertProbeBytes,
	assertProbeIsolation,
	resolveStagingFailure,
	assertSignedStorageUrl,
	assertStorageListIsolation,
	assertSuccessfulSignOut,
	runStagingCleanup,
	assertUnauthorizedAccount
} from '../../../tools/checks/supabase-staging-contract.mjs';

const authorizedUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unauthorizedUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const probeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const storageFolder = `${authorizedUserId}/__staging_probe_cccccccc`;
const storageFileName = 'probe.png';
const storagePath = `${storageFolder}/${storageFileName}`;

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

	it('requires Storage listing to expose the sentinel only to its owner', () => {
		expect(() =>
			assertStorageListIsolation({
				fileName: storageFileName,
				ownerRows: [{ name: storageFileName, metadata: { mimetype: 'image/png' } }],
				outsiderRows: []
			})
		).not.toThrow();
		expect(() =>
			assertStorageListIsolation({
				fileName: storageFileName,
				ownerRows: [{ name: storageFileName }],
				outsiderRows: [{ name: storageFileName }]
			})
		).toThrow(/second account/);
	});

	it('compares downloaded Storage bytes without text coercion', () => {
		const expected = Uint8Array.from([0, 1, 2, 127, 128, 255]);
		expect(() => assertProbeBytes({ expected, actual: expected.slice() })).not.toThrow();
		expect(() =>
			assertProbeBytes({ expected, actual: Uint8Array.from([0, 1, 2, 127, 128, 254]) })
		).toThrow(/bytes/);
	});

	it('requires denied Storage operations to return no usable data', () => {
		expect(() =>
			assertDeniedStorageOperation({
				label: 'download',
				data: null,
				error: new Error('Object not found')
			})
		).not.toThrow();
		expect(() =>
			assertDeniedStorageOperation({
				label: 'signed URL',
				data: { signedUrl: 'https://example.test/leak' },
				error: null
			})
		).toThrow(/unexpectedly succeeded/);
	});

	it('preserves verification and cleanup failures without masking either cause', () => {
		const verificationError = new Error('verification failed');
		const cleanupError = new Error('cleanup failed');

		expect(resolveStagingFailure({ operationError: verificationError, cleanupResults: [] })).toBe(
			verificationError
		);
		expect(
			resolveStagingFailure({
				operationError: null,
				cleanupResults: [{ status: 'rejected', reason: cleanupError }]
			})
		).toBe(cleanupError);

		const combined = resolveStagingFailure({
			operationError: verificationError,
			cleanupResults: [{ status: 'rejected', reason: cleanupError }]
		});
		expect(combined).toBeInstanceOf(AggregateError);
		expect((combined as AggregateError).errors).toEqual([verificationError, cleanupError]);
	});

	it('rejects a resolved sign-out response that still contains an auth error', () => {
		expect(() =>
			assertSuccessfulSignOut({ label: 'authorized account', error: null })
		).not.toThrow();
		expect(() =>
			assertSuccessfulSignOut({ label: 'second account', error: new Error('session unavailable') })
		).toThrow(/second account sign-out failed/);
	});

	it('finishes authenticated cleanup before invalidating sessions', async () => {
		const events: string[] = [];
		const cleanupResults = await runStagingCleanup({
			dataCleanup: [
				async () => {
					events.push('data:start');
					await Promise.resolve();
					events.push('data:end');
				}
			],
			sessionCleanup: [async () => events.push('session')]
		});

		expect(events).toEqual(['data:start', 'data:end', 'session']);
		expect(cleanupResults).toHaveLength(2);
		expect(cleanupResults.every((result) => result.status === 'fulfilled')).toBe(true);
	});

	it('accepts only a same-origin signed URL for the exact sentinel object', () => {
		const supabaseUrl = 'https://project.supabase.co';
		const signedUrl = `${supabaseUrl}/storage/v1/object/sign/documents/${storagePath}?token=signed-token`;

		expect(() =>
			assertSignedStorageUrl({ signedUrl, supabaseUrl, objectPath: storagePath })
		).not.toThrow();
		expect(() =>
			assertSignedStorageUrl({
				signedUrl: `https://other.example/storage/v1/object/sign/documents/${storagePath}?token=x`,
				supabaseUrl,
				objectPath: storagePath
			})
		).toThrow(/origin/);
		expect(() =>
			assertSignedStorageUrl({
				signedUrl: `${supabaseUrl}/storage/v1/object/sign/documents/${authorizedUserId}/other.png?token=x`,
				supabaseUrl,
				objectPath: storagePath
			})
		).toThrow(/exact Storage object/);
	});
});
