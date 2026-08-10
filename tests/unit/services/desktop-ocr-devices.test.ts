import { describe, expect, it, vi } from 'vitest';
import {
	createDesktopOcrPairingCode,
	deleteDesktopOcrDevice,
	DesktopOcrDevicesError,
	listDesktopOcrDevices,
	renameDesktopOcrDevice,
	revokeDesktopOcrDevice
} from '../../../src/lib/services/desktop-ocr-devices';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const PAIRING_ID = '22222222-2222-4222-8222-222222222222';

function device(overrides: Record<string, unknown> = {}) {
	return {
		device_id: DEVICE_ID,
		label: 'Desktop principal',
		status: 'active',
		capabilities: {
			protocolVersion: 1,
			backend: 'ollama',
			model: 'qwen3-vl:4b',
			modelDigest: 'a'.repeat(64),
			maxConcurrency: 1,
			privateUnexpectedField: 'ignored'
		},
		last_seen_at: '2026-08-10T02:00:00.000Z',
		revoked_at: null,
		created_at: '2026-08-09T22:00:00.000Z',
		updated_at: '2026-08-10T02:00:00.000Z',
		...overrides
	};
}

describe('desktop OCR device service', () => {
	it('lists devices while exposing only bounded display capabilities', async () => {
		const rpc = vi.fn(async () => ({ data: [device()], error: null }));
		const devices = await listDesktopOcrDevices({ rpc } as never);

		expect(rpc).toHaveBeenCalledWith('list_ocr_worker_devices');
		expect(devices).toEqual([
			{
				id: DEVICE_ID,
				label: 'Desktop principal',
				status: 'active',
				capabilities: {
					protocolVersion: 1,
					backend: 'ollama',
					model: 'qwen3-vl:4b',
					maxConcurrency: 1
				},
				lastSeenAt: '2026-08-10T02:00:00.000Z',
				revokedAt: null,
				createdAt: '2026-08-09T22:00:00.000Z',
				updatedAt: '2026-08-10T02:00:00.000Z'
			}
		]);
		expect(JSON.stringify(devices)).not.toContain('modelDigest');
		expect(JSON.stringify(devices)).not.toContain('privateUnexpectedField');
	});

	it('creates a bounded one-time pairing code without exposing any worker credential', async () => {
		const rpc = vi.fn(async () => ({
			data: {
				pairingId: PAIRING_ID,
				code: 'ABCD-1234-EF56-7890',
				expiresAt: '2026-08-10T05:00:00.000Z'
			},
			error: null
		}));

		await expect(createDesktopOcrPairingCode({ rpc } as never)).resolves.toEqual({
			pairingId: PAIRING_ID,
			code: 'ABCD-1234-EF56-7890',
			expiresAt: '2026-08-10T05:00:00.000Z'
		});
		expect(rpc).toHaveBeenCalledWith('create_ocr_worker_pairing_code');
		expect(JSON.stringify(rpc.mock.calls)).not.toContain('credential');
	});

	it('fails closed on malformed pairing-code receipts', async () => {
		const rpc = vi.fn(async () => ({
			data: {
				pairingId: PAIRING_ID,
				code: 'not-a-code',
				expiresAt: '2026-08-10T05:00:00.000Z'
			},
			error: null
		}));
		await expect(createDesktopOcrPairingCode({ rpc } as never)).rejects.toBeInstanceOf(
			DesktopOcrDevicesError
		);
	});

	it('accepts a revoked device only when a valid revoked timestamp is present', async () => {
		const rpc = vi.fn(async () => ({
			data: [
				device({
					status: 'revoked',
					revoked_at: '2026-08-10T03:00:00.000Z'
				})
			],
			error: null
		}));

		const devices = await listDesktopOcrDevices({ rpc } as never);
		expect(devices[0]?.status).toBe('revoked');
		expect(devices[0]?.revokedAt).toBe('2026-08-10T03:00:00.000Z');
	});

	it('fails closed on malformed device rows instead of partially trusting them', async () => {
		const rpc = vi.fn(async () => ({ data: [device({ device_id: '../escape' })], error: null }));
		await expect(listDesktopOcrDevices({ rpc } as never)).rejects.toBeInstanceOf(
			DesktopOcrDevicesError
		);
	});

	it('revokes only the requested UUID and parses the bounded receipt', async () => {
		const rpc = vi.fn(async () => ({
			data: {
				deviceId: DEVICE_ID,
				status: 'revoked',
				revokedAt: '2026-08-10T03:00:00.000Z',
				requeuedJobs: 2
			},
			error: null
		}));

		await expect(revokeDesktopOcrDevice(DEVICE_ID, { rpc } as never)).resolves.toEqual({
			deviceId: DEVICE_ID,
			status: 'revoked',
			revokedAt: '2026-08-10T03:00:00.000Z',
			requeuedJobs: 2
		});
		expect(rpc).toHaveBeenCalledWith('revoke_ocr_worker_device', {
			target_device_id: DEVICE_ID
		});
	});

	it('renames an active device with a normalized bounded label', async () => {
		const rpc = vi.fn(async () => ({
			data: {
				deviceId: DEVICE_ID,
				label: 'PC do escritório',
				updatedAt: '2026-08-10T04:30:00.000Z'
			},
			error: null
		}));

		await expect(
			renameDesktopOcrDevice(DEVICE_ID, '  PC do escritório  ', { rpc } as never)
		).resolves.toEqual({
			deviceId: DEVICE_ID,
			label: 'PC do escritório',
			updatedAt: '2026-08-10T04:30:00.000Z'
		});
		expect(rpc).toHaveBeenCalledWith('rename_ocr_worker_device', {
			target_device_id: DEVICE_ID,
			device_label: 'PC do escritório'
		});
	});

	it('deletes only the requested revoked UUID and parses the bounded receipt', async () => {
		const rpc = vi.fn(async () => ({
			data: {
				deviceId: DEVICE_ID,
				deleted: true,
				pairingCodesDeleted: 1
			},
			error: null
		}));

		await expect(deleteDesktopOcrDevice(DEVICE_ID, { rpc } as never)).resolves.toEqual({
			deviceId: DEVICE_ID,
			deleted: true,
			pairingCodesDeleted: 1
		});
		expect(rpc).toHaveBeenCalledWith('delete_ocr_worker_device', {
			target_device_id: DEVICE_ID
		});
	});

	it('rejects invalid ids and labels before reaching Supabase', async () => {
		const rpc = vi.fn();
		await expect(revokeDesktopOcrDevice('../device', { rpc } as never)).rejects.toThrow(
			'device id'
		);
		await expect(deleteDesktopOcrDevice('../device', { rpc } as never)).rejects.toThrow(
			'device id'
		);
		await expect(renameDesktopOcrDevice(DEVICE_ID, '   ', { rpc } as never)).rejects.toThrow(
			'device label'
		);
		await expect(
			renameDesktopOcrDevice(DEVICE_ID, 'x'.repeat(81), { rpc } as never)
		).rejects.toThrow('device label');
		expect(rpc).not.toHaveBeenCalled();
	});

	it('fails closed when mutation receipts do not match the requested mutation', async () => {
		const renameRpc = vi.fn(async () => ({
			data: {
				deviceId: DEVICE_ID,
				label: 'Outro nome',
				updatedAt: '2026-08-10T04:30:00.000Z'
			},
			error: null
		}));

		await expect(
			renameDesktopOcrDevice(DEVICE_ID, 'Nome esperado', { rpc: renameRpc } as never)
		).rejects.toBeInstanceOf(DesktopOcrDevicesError);

		const deleteRpc = vi.fn(async () => ({
			data: {
				deviceId: DEVICE_ID,
				deleted: true,
				pairingCodesDeleted: -1
			},
			error: null
		}));
		await expect(deleteDesktopOcrDevice(DEVICE_ID, { rpc: deleteRpc } as never)).rejects.toBeInstanceOf(
			DesktopOcrDevicesError
		);
	});

	it('maps transport and backend failures to safe user-facing errors', async () => {
		const throwingRpc = vi.fn(async () => {
			throw new Error('private backend details');
		});
		await expect(listDesktopOcrDevices({ rpc: throwingRpc } as never)).rejects.toMatchObject({
			name: 'DesktopOcrDevicesError'
		});
		await expect(createDesktopOcrPairingCode({ rpc: throwingRpc } as never)).rejects.toMatchObject({
			name: 'DesktopOcrDevicesError'
		});

		const failingRpc = vi.fn(async () => ({ data: null, error: { private: 'details' } }));
		const error = await revokeDesktopOcrDevice(DEVICE_ID, { rpc: failingRpc } as never).catch(
			(caught) => caught
		);
		expect(error).toBeInstanceOf(DesktopOcrDevicesError);
		expect(String(error)).not.toContain('details');

		const renameError = await renameDesktopOcrDevice(DEVICE_ID, 'Nome novo', {
			rpc: failingRpc
		} as never).catch((caught) => caught);
		expect(renameError).toBeInstanceOf(DesktopOcrDevicesError);
		expect(String(renameError)).not.toContain('details');

		const deleteError = await deleteDesktopOcrDevice(DEVICE_ID, { rpc: failingRpc } as never).catch(
			(caught) => caught
		);
		expect(deleteError).toBeInstanceOf(DesktopOcrDevicesError);
		expect(String(deleteError)).not.toContain('details');
	});
});
