import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
	DesktopPairingCodeError,
	pairDesktopWorkerWithCode
} from '../../../tools/desktop-worker/pair-code.mjs';

const WORKER_ENDPOINT = 'https://example.supabase.co/functions/v1/desktop-ocr-worker';
const PAIR_ENDPOINT = 'https://example.supabase.co/functions/v1/desktop-ocr-pair';
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_PATH = '/tmp/fichario-worker/device.json';
const PAIRING_CODE = 'ABCD-1234-EF56-7890';
const CAPABILITIES = {
	protocolVersion: 1,
	backend: 'ollama',
	model: 'qwen3-vl:4b',
	modelDigest: 'a'.repeat(64),
	maxConcurrency: 1
};
const RANDOM_BYTES = Buffer.alloc(32, 7);
const GENERATED_CREDENTIAL = RANDOM_BYTES.toString('base64url');
const GENERATED_DIGEST = createHash('sha256').update(GENERATED_CREDENTIAL, 'utf8').digest('hex');

function response(body: unknown, status = 201) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function receipt(overrides: Record<string, unknown> = {}) {
	return {
		deviceId: DEVICE_ID,
		label: 'Desktop principal',
		status: 'active',
		capabilities: {
			maxConcurrency: 1,
			modelDigest: 'a'.repeat(64),
			model: 'qwen3-vl:4b',
			backend: 'ollama',
			protocolVersion: 1
		},
		createdAt: '2026-08-10T04:45:00.000Z',
		...overrides
	};
}

function dependencies() {
	return {
		credentialStore: {
			store: vi.fn(async () => true),
			clear: vi.fn(async () => true)
		},
		saveMetadata: vi.fn(async (_path, value) => value),
		randomBytesImpl: vi.fn(() => RANDOM_BYTES)
	};
}

describe('pairDesktopWorkerWithCode', () => {
	it('keeps the long worker credential local and redeems only its SHA-256 digest', async () => {
		const { credentialStore, saveMetadata, randomBytesImpl } = dependencies();
		const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe(PAIR_ENDPOINT);
			expect(new Headers(init?.headers).has('Authorization')).toBe(false);
			expect(init?.redirect).toBe('error');
			const body = JSON.parse(String(init?.body));
			expect(body).toEqual({
				action: 'redeem',
				pairingCode: PAIRING_CODE,
				label: 'Desktop principal',
				capabilities: CAPABILITIES,
				credentialDigest: GENERATED_DIGEST
			});
			expect(String(init?.body)).not.toContain(GENERATED_CREDENTIAL);
			return response(receipt());
		});

		const result = await pairDesktopWorkerWithCode(
			{
				workerEndpoint: WORKER_ENDPOINT,
				label: 'Desktop principal',
				capabilities: CAPABILITIES,
				pairingCode: PAIRING_CODE.toLowerCase(),
				devicePath: DEVICE_PATH,
				credentialStore
			},
			{ fetchImpl, saveMetadata, randomBytesImpl }
		);

		expect(randomBytesImpl).toHaveBeenCalledWith(32);
		expect(credentialStore.store).toHaveBeenCalledWith(DEVICE_ID, GENERATED_CREDENTIAL, {
			signal: undefined
		});
		expect(saveMetadata).toHaveBeenCalledWith(DEVICE_PATH, {
			schemaVersion: 1,
			deviceId: DEVICE_ID,
			label: 'Desktop principal',
			workerEndpoint: WORKER_ENDPOINT,
			createdAt: '2026-08-10T04:45:00.000Z'
		});
		expect(result).toEqual({
			deviceId: DEVICE_ID,
			label: 'Desktop principal',
			status: 'active',
			createdAt: '2026-08-10T04:45:00.000Z'
		});
		expect(JSON.stringify(result)).not.toContain(GENERATED_CREDENTIAL);
	});

	it('fails closed when the server receipt does not exactly bind the requested capabilities', async () => {
		const { credentialStore, saveMetadata, randomBytesImpl } = dependencies();
		await expect(
			pairDesktopWorkerWithCode(
				{
					workerEndpoint: WORKER_ENDPOINT,
					label: 'Desktop principal',
					capabilities: CAPABILITIES,
					pairingCode: PAIRING_CODE,
					devicePath: DEVICE_PATH,
					credentialStore
				},
				{
					fetchImpl: vi.fn(async () =>
						response(receipt({ capabilities: { ...CAPABILITIES, maxConcurrency: 2 } }))
					),
					saveMetadata,
					randomBytesImpl
				}
			)
		).rejects.toMatchObject({ code: 'desktop_ocr_pair_response_invalid' });
		expect(credentialStore.store).not.toHaveBeenCalled();
	});

	it('clears a partially stored local credential and requires explicit web revoke if metadata commit fails', async () => {
		const { credentialStore, randomBytesImpl } = dependencies();
		const error = await pairDesktopWorkerWithCode(
			{
				workerEndpoint: WORKER_ENDPOINT,
				label: 'Desktop principal',
				capabilities: CAPABILITIES,
				pairingCode: PAIRING_CODE,
				devicePath: DEVICE_PATH,
				credentialStore
			},
			{
				fetchImpl: vi.fn(async () => response(receipt())),
				saveMetadata: vi.fn(async () => {
					throw new Error(`private ${GENERATED_CREDENTIAL}`);
				}),
				randomBytesImpl
			}
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(DesktopPairingCodeError);
		expect(error.code).toBe('desktop_ocr_pair_local_commit_failed_revoke_required');
		expect(String(error)).not.toContain(GENERATED_CREDENTIAL);
		expect(credentialStore.clear).toHaveBeenCalledWith(DEVICE_ID);
	});

	it('rejects malformed codes and endpoints before any network request', async () => {
		const { credentialStore, saveMetadata, randomBytesImpl } = dependencies();
		const fetchImpl = vi.fn();

		await expect(
			pairDesktopWorkerWithCode(
				{
					workerEndpoint: WORKER_ENDPOINT,
					label: 'Desktop principal',
					capabilities: CAPABILITIES,
					pairingCode: 'not-a-code',
					devicePath: DEVICE_PATH,
					credentialStore
				},
				{ fetchImpl, saveMetadata, randomBytesImpl }
			)
		).rejects.toThrow('pairing code');

		await expect(
			pairDesktopWorkerWithCode(
				{
					workerEndpoint: 'http://127.0.0.1/functions/v1/desktop-ocr-worker',
					label: 'Desktop principal',
					capabilities: CAPABILITIES,
					pairingCode: PAIRING_CODE,
					devicePath: DEVICE_PATH,
					credentialStore
				},
				{ fetchImpl, saveMetadata, randomBytesImpl }
			)
		).rejects.toThrow('endpoint');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('surfaces only a bounded safe backend code when a code is unavailable', async () => {
		const { credentialStore, saveMetadata, randomBytesImpl } = dependencies();
		const error = await pairDesktopWorkerWithCode(
			{
				workerEndpoint: WORKER_ENDPOINT,
				label: 'Desktop principal',
				capabilities: CAPABILITIES,
				pairingCode: PAIRING_CODE,
				devicePath: DEVICE_PATH,
				credentialStore
			},
			{
				fetchImpl: vi.fn(async () =>
					response({ code: 'desktop_ocr_pairing_code_unavailable' }, 409)
				),
				saveMetadata,
				randomBytesImpl
			}
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(DesktopPairingCodeError);
		expect(error).toMatchObject({ code: 'desktop_ocr_pairing_code_unavailable', httpStatus: 409 });
		expect(String(error)).not.toContain(PAIRING_CODE);
		expect(String(error)).not.toContain(GENERATED_CREDENTIAL);
		expect(credentialStore.store).not.toHaveBeenCalled();
	});
});
