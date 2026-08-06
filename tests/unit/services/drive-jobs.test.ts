import { describe, expect, it, vi } from 'vitest';
import {
	listDriveJobs,
	parseDriveJobReceipt,
	runPendingDriveJobs
} from '../../../src/lib/services/drive-jobs';

const jobId = '11111111-1111-4111-8111-111111111111';

function job(overrides: Record<string, unknown> = {}) {
	return {
		id: jobId,
		operation: 'rename_folder',
		status: 'retryable',
		attempt_count: 2,
		next_retry_at: '2026-08-06T14:30:00.000Z',
		last_error_code: 'drive_rate_limited',
		last_error_message: 'Google Drive temporariamente indisponível.',
		created_at: '2026-08-06T14:00:00.000Z',
		finished_at: null,
		...overrides
	};
}

describe('Drive job service', () => {
	it('parses strict worker receipts', () => {
		expect(
			parseDriveJobReceipt({
				status: 'completed',
				processed: 3,
				synced: 2,
				retryable: 1,
				conflicts: 0
			})
		).toEqual({ status: 'completed', processed: 3, synced: 2, retryable: 1, conflicts: 0 });
		expect(() =>
			parseDriveJobReceipt({
				status: 'completed',
				processed: 3,
				synced: 2,
				retryable: 1,
				conflicts: 0,
				accessToken: 'secret'
			})
		).toThrow('Invalid Drive job receipt');
		expect(() =>
			parseDriveJobReceipt({
				status: 'completed',
				processed: 1,
				synced: 1,
				retryable: 1,
				conflicts: 0
			})
		).toThrow('Invalid Drive job receipt');
	});

	it('invokes the job runner and returns a frozen receipt', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: { status: 'partial', processed: 25, synced: 23, retryable: 1, conflicts: 1 },
			error: null
		});
		const result = await runPendingDriveJobs({ functions: { invoke } } as never);

		expect(result.status).toBe('partial');
		expect(Object.isFrozen(result)).toBe(true);
		expect(invoke).toHaveBeenCalledWith('drive-run-jobs', { body: {} });
	});

	it('lists bounded public job receipts without payloads or leases', async () => {
		const limit = vi.fn().mockResolvedValue({ data: [job()], error: null });
		const order = vi.fn(() => ({ limit }));
		const select = vi.fn(() => ({ order }));
		const from = vi.fn(() => ({ select }));

		await expect(listDriveJobs({ from } as never)).resolves.toEqual([
			{
				id: jobId,
				operation: 'rename_folder',
				status: 'retryable',
				attemptCount: 2,
				nextRetryAt: '2026-08-06T14:30:00.000Z',
				lastErrorCode: 'drive_rate_limited',
				lastErrorMessage: 'Google Drive temporariamente indisponível.',
				createdAt: '2026-08-06T14:00:00.000Z',
				finishedAt: null
			}
		]);
		expect(from).toHaveBeenCalledWith('drive_sync_jobs');
		expect(select).toHaveBeenCalledWith(
			'id,operation,status,attempt_count,next_retry_at,last_error_code,last_error_message,created_at,finished_at'
		);
		expect(limit).toHaveBeenCalledWith(100);
	});

	it('rejects malformed rows and backend failures', async () => {
		const client = (data: unknown, error: unknown = null) => ({
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data, error }) }))
				}))
			}))
		});
		await expect(
			listDriveJobs(client([{ ...job(), refresh_token: 'secret' }]) as never)
		).rejects.toThrow('Não foi possível carregar a fila do Google Drive.');
		await expect(listDriveJobs(client(null, { message: 'offline' }) as never)).rejects.toThrow(
			'Não foi possível carregar a fila do Google Drive.'
		);
		await expect(
			runPendingDriveJobs({
				functions: {
					invoke: vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } })
				}
			} as never)
		).rejects.toThrow('Não foi possível executar a fila do Google Drive.');
	});
});
