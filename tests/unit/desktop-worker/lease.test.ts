import { describe, expect, it, vi } from 'vitest';
import { DesktopWorkerApiError } from '../../../tools/desktop-worker/client.mjs';
import { runWithLeaseRenewal } from '../../../tools/desktop-worker/lease.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_ID = '44444444-4444-4444-8444-444444444444';

function lease(expiresAt = '2026-08-10T02:00:20.000Z') {
	return {
		jobId: JOB_ID,
		pageId: PAGE_ID,
		deviceId: DEVICE_ID,
		leaseId: LEASE_ID,
		leaseExpiresAt: expiresAt
	};
}

function untilAbort() {
	return (_milliseconds: number, signal?: AbortSignal) =>
		new Promise<void>((_resolve, reject) => {
			if (signal?.aborted) {
				reject(signal.reason);
				return;
			}
			signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
		});
}

describe('runWithLeaseRenewal', () => {
	it('renews halfway through the remaining lease and exposes the renewed receipt to the operation', async () => {
		let renewed!: () => void;
		const renewalStarted = new Promise<void>((resolve) => {
			renewed = resolve;
		});
		const renewedLease = lease('2026-08-10T02:02:00.000Z');
		const client = {
			renew: vi.fn(async () => {
				renewed();
				return renewedLease;
			})
		};
		const sleep = vi.fn().mockResolvedValueOnce(undefined).mockImplementation(untilAbort());

		const result = await runWithLeaseRenewal(
			{ client, lease: lease() },
			async ({ getLease }) => {
				await renewalStarted;
				await Promise.resolve();
				return getLease().leaseExpiresAt;
			},
			{
				now: () => Date.parse('2026-08-10T02:00:00.000Z'),
				sleep
			}
		);

		expect(sleep.mock.calls[0]?.[0]).toBe(10_000);
		expect(client.renew).toHaveBeenCalledWith(JOB_ID, LEASE_ID, { signal: undefined });
		expect(result.value).toBe(renewedLease.leaseExpiresAt);
		expect(result.lease).toEqual(renewedLease);
		expect(result.renewalFailure).toBeNull();
	});

	it('records a safe renewal failure without aborting already-running OCR work', async () => {
		let attempted!: () => void;
		const renewalAttempted = new Promise<void>((resolve) => {
			attempted = resolve;
		});
		const client = {
			renew: vi.fn(async () => {
				attempted();
				throw new DesktopWorkerApiError(409, 'desktop_ocr_lease_not_active');
			})
		};
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await runWithLeaseRenewal(
			{ client, lease: lease() },
			async ({ getRenewalFailure }) => {
				await renewalAttempted;
				await new Promise((resolve) => setTimeout(resolve, 0));
				return getRenewalFailure();
			},
			{
				now: () => Date.parse('2026-08-10T02:00:00.000Z'),
				sleep
			}
		);

		expect(result.value).toEqual({
			code: 'desktop_ocr_lease_not_active',
			httpStatus: 409
		});
		expect(result.renewalFailure).toEqual(result.value);
	});

	it('stops the renewal loop when the protected operation finishes', async () => {
		const client = { renew: vi.fn() };
		const sleep = vi.fn(untilAbort());

		const result = await runWithLeaseRenewal({ client, lease: lease() }, async () => 'done', {
			now: () => Date.parse('2026-08-10T02:00:00.000Z'),
			sleep
		});

		expect(result.value).toBe('done');
		expect(client.renew).not.toHaveBeenCalled();
		expect(sleep).toHaveBeenCalledOnce();
	});

	it('propagates operation cancellation and still stops the renewal loop', async () => {
		const client = { renew: vi.fn() };
		const sleep = vi.fn(untilAbort());
		const controller = new AbortController();
		const operation = vi.fn(async () => {
			controller.abort(new DOMException('stop', 'AbortError'));
			throw controller.signal.reason;
		});

		await expect(
			runWithLeaseRenewal({ client, lease: lease() }, operation, {
				signal: controller.signal,
				now: () => Date.parse('2026-08-10T02:00:00.000Z'),
				sleep
			})
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(client.renew).not.toHaveBeenCalled();
	});
});
