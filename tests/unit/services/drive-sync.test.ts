import { describe, expect, it, vi } from 'vitest';
import { synchronizeDriveConnection } from '../../../src/lib/services/drive';

function client(response: { data: unknown; error: unknown }) {
	const invoke = vi.fn().mockResolvedValue(response);
	return { value: { functions: { invoke } }, invoke };
}

describe('Drive synchronization service', () => {
	it('accepts a strict completed or partial synchronization receipt', async () => {
		const completed = client({
			data: { status: 'completed', pages: 2, applied: 4, ignored: 1, conflicts: 0 },
			error: null
		});
		await expect(synchronizeDriveConnection(completed.value)).resolves.toEqual({
			status: 'completed',
			pages: 2,
			applied: 4,
			ignored: 1,
			conflicts: 0
		});
		expect(completed.invoke).toHaveBeenCalledWith('drive-sync', { body: {} });

		const partial = client({
			data: { status: 'partial', pages: 100, applied: 300, ignored: 2, conflicts: 1 },
			error: null
		});
		await expect(synchronizeDriveConnection(partial.value)).resolves.toMatchObject({
			status: 'partial',
			pages: 100,
			conflicts: 1
		});
	});

	it('rejects malformed receipts, extra token fields, and invocation errors', async () => {
		await expect(
			synchronizeDriveConnection(
				client({
					data: {
						status: 'completed',
						pages: 1,
						applied: 1,
						ignored: 0,
						conflicts: 0,
						accessToken: 'must-not-pass'
					},
					error: null
				}).value
			)
		).rejects.toThrow('Não foi possível sincronizar o Google Drive.');
		await expect(
			synchronizeDriveConnection(
				client({
					data: { status: 'completed', pages: -1, applied: 0, ignored: 0, conflicts: 0 },
					error: null
				}).value
			)
		).rejects.toThrow('Não foi possível sincronizar o Google Drive.');
		await expect(
			synchronizeDriveConnection(client({ data: null, error: new Error('offline') }).value)
		).rejects.toThrow('Não foi possível sincronizar o Google Drive.');
	});
});
