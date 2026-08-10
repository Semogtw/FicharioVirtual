import { describe, expect, it, vi } from 'vitest';
import {
	DesktopOcrJobsError,
	listDesktopOcrJobs
} from '../../../src/lib/services/desktop-ocr-jobs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const DEVICE_ID = '44444444-4444-4444-8444-444444444444';

function row(overrides: Record<string, unknown> = {}) {
	return {
		job_id: JOB_ID,
		page_id: PAGE_ID,
		document_id: DOCUMENT_ID,
		document_title: 'Caderno digitalizado',
		page_number: 4,
		status: 'processing',
		attempt_count: 2,
		last_error_code: null,
		device_id: DEVICE_ID,
		device_label: 'Desktop principal',
		lease_started_at: '2026-08-10T05:00:00.000Z',
		lease_expires_at: '2026-08-10T05:02:00.000Z',
		lease_expired: false,
		created_at: '2026-08-10T04:50:00.000Z',
		updated_at: '2026-08-10T05:00:00.000Z',
		...overrides
	};
}

describe('desktop OCR queue service', () => {
	it('parses bounded owner queue metadata without a lease nonce or OCR payload', async () => {
		const rpc = vi.fn(async () => ({ data: [row()], error: null }));
		const jobs = await listDesktopOcrJobs({ rpc } as never);

		expect(rpc).toHaveBeenCalledWith('list_desktop_ocr_jobs');
		expect(jobs).toEqual([
			{
				id: JOB_ID,
				pageId: PAGE_ID,
				documentId: DOCUMENT_ID,
				documentTitle: 'Caderno digitalizado',
				pageNumber: 4,
				status: 'processing',
				attemptCount: 2,
				lastErrorCode: null,
				deviceId: DEVICE_ID,
				deviceLabel: 'Desktop principal',
				leaseStartedAt: '2026-08-10T05:00:00.000Z',
				leaseExpiresAt: '2026-08-10T05:02:00.000Z',
				leaseExpired: false,
				createdAt: '2026-08-10T04:50:00.000Z',
				updatedAt: '2026-08-10T05:00:00.000Z'
			}
		]);
		expect(JSON.stringify(jobs)).not.toContain('leaseId');
		expect(JSON.stringify(jobs)).not.toContain('ocr_raw_text');
	});

	it('accepts waiting work without a device or lease', async () => {
		const rpc = vi.fn(async () => ({
			data: [
				row({
					status: 'waiting_desktop',
					device_id: null,
					device_label: null,
					lease_started_at: null,
					lease_expires_at: null,
					lease_expired: false
				})
			],
			error: null
		}));

		const jobs = await listDesktopOcrJobs({ rpc } as never);
		expect(jobs[0]?.status).toBe('waiting_desktop');
		expect(jobs[0]?.deviceId).toBeNull();
	});

	it('accepts an expired processing lease only when the full lease binding is present', async () => {
		const rpc = vi.fn(async () => ({ data: [row({ lease_expired: true })], error: null }));
		const jobs = await listDesktopOcrJobs({ rpc } as never);
		expect(jobs[0]?.leaseExpired).toBe(true);
	});

	it('fails closed on malformed identifiers, status, or lease shapes', async () => {
		for (const invalid of [
			row({ job_id: '../escape' }),
			row({ status: 'waiting_magic' }),
			row({ status: 'processing', device_id: null, device_label: null }),
			row({ status: 'waiting_desktop', lease_expired: true })
		]) {
			const rpc = vi.fn(async () => ({ data: [invalid], error: null }));
			await expect(listDesktopOcrJobs({ rpc } as never)).rejects.toBeInstanceOf(
				DesktopOcrJobsError
			);
		}
	});

	it('rejects oversized result arrays before exposing partial data', async () => {
		const rpc = vi.fn(async () => ({
			data: Array.from({ length: 101 }, () => row()),
			error: null
		}));
		await expect(listDesktopOcrJobs({ rpc } as never)).rejects.toBeInstanceOf(DesktopOcrJobsError);
	});

	it('maps transport/backend details to a safe error', async () => {
		const throwingRpc = vi.fn(async () => {
			throw new Error('private database details');
		});
		const transport = await listDesktopOcrJobs({ rpc: throwingRpc } as never).catch(
			(error) => error
		);
		expect(transport).toBeInstanceOf(DesktopOcrJobsError);
		expect(String(transport)).not.toContain('database details');

		const failingRpc = vi.fn(async () => ({ data: null, error: { secret: 'details' } }));
		const backend = await listDesktopOcrJobs({ rpc: failingRpc } as never).catch((error) => error);
		expect(backend).toBeInstanceOf(DesktopOcrJobsError);
		expect(String(backend)).not.toContain('details');
	});
});
