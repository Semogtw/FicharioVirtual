import { describe, expect, it, vi } from 'vitest';
import { DesktopPairingError, pairDesktopWorker } from '../../../tools/desktop-worker/pairing.mjs';

const WORKER_ENDPOINT = 'https://example.supabase.co/functions/v1/desktop-ocr-worker';
const PAIR_ENDPOINT = 'https://example.supabase.co/functions/v1/desktop-ocr-pair';
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const ACCESS_TOKEN = 'header.payload.signature';
const CREDENTIAL = 'A'.repeat(43);
const DEVICE_PATH = '/tmp/fichario-worker/device.json';
const CAPABILITIES = {
	protocolVersion: 1,
	backend: 'ollama',
	model: 'qwen3-vl:4b',
	modelDigest: 'a'.repeat(64),
	maxConcurrency: 1
};

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
		// Deliberately reorder keys to model jsonb serialization from PostgreSQL.
		capabilities: {
			maxConcurrency: 1,
			modelDigest: 'a'.repeat(64),
			model: 'qwen3-vl:4b',
			backend: 'ollama',
			protocolVersion: 1
		},
		createdAt: '2026-08-10T02:30:00.000Z',
		credential: CREDENTIAL,
		...overrides
	};
}

function dependencies() {
	return {
		credentialStore: {
			store: vi.fn(async () => true),
			clear: vi.fn(async () => true)
		},
		saveMetadata: vi.fn(async (_path, value) => value)
	};
}

describe('pairDesktopWorker', () => {
	it('uses the browser session only in the ephemeral Authorization header and persists only the worker credential', async () => {
		const { credentialStore, saveMetadata } = dependencies();
		const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe(PAIR_ENDPOINT);
			expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
			expect(init?.redirect).toBe('error');
			expect(String(init?.body)).not.toContain(ACCESS_TOKEN);
			expect(JSON.parse(String(init?.body))).toEqual({
				label: 'Desktop principal',
				capabilities: CAPABILITIES
			});
			return response(receipt());
		});

		const result = await pairDesktopWorker(
			{
				workerEndpoint: WORKER_ENDPOINT,
				label: 'Desktop principal',
				capabilities: CAPABILITIES,
				accessToken: ACCESS_TOKEN,
				devicePath: DEVICE_PATH,
				credentialStore
			},
			{ fetchImpl, saveMetadata }
		);

		expect(credentialStore.store).toHaveBeenCalledWith(DEVICE_ID, CREDENTIAL, {
			signal: undefined
		});
		expect(saveMetadata).toHaveBeenCalledWith(DEVICE_PATH, {
			schemaVersion: 1,
			deviceId: DEVICE_ID,
			label: 'Desktop principal',
			workerEndpoint: WORKER_ENDPOINT,
			createdAt: '2026-08-10T02:30:00.000Z'
		});
		expect(result).toEqual({
			deviceId: DEVICE_ID,
			label: 'Desktop principal',
			status: 'active',
			createdAt: '2026-08-10T02:30:00.000Z'
		});
		expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
		expect(JSON.stringify(saveMetadata.mock.calls)).not.toContain(ACCESS_TOKEN);
	});

	it('clears the just-created keyring entry when durable metadata cannot be committed', async () => {
		const { credentialStore } = dependencies();
		const metadataFailure = new Error('synthetic metadata failure');
		const saveMetadata = vi.fn(async () => {
			throw metadataFailure;
		});

		await expect(
			pairDesktopWorker(
				{
					workerEndpoint: WORKER_ENDPOINT,
					label: 'Desktop principal',
					capabilities: CAPABILITIES,
					accessToken: ACCESS_TOKEN,
					devicePath: DEVICE_PATH,
					credentialStore
				},
				{ fetchImpl: vi.fn(async () => response(receipt())), saveMetadata }
			)
		).rejects.toBe(metadataFailure);

		expect(credentialStore.clear).toHaveBeenCalledWith(DEVICE_ID, { signal: undefined });
	});

	it('does not store a credential when the server response does not exactly bind the requested capabilities', async () => {
		const { credentialStore, saveMetadata } = dependencies();
		const fetchImpl = vi.fn(async () =>
			response(
				receipt({
					capabilities: { ...CAPABILITIES, maxConcurrency: 2 }
				})
			)
		);

		await expect(
			pairDesktopWorker(
				{
					workerEndpoint: WORKER_ENDPOINT,
					label: 'Desktop principal',
					capabilities: CAPABILITIES,
					accessToken: ACCESS_TOKEN,
					devicePath: DEVICE_PATH,
					credentialStore
				},
				{ fetchImpl, saveMetadata }
			)
		).rejects.toMatchObject({ code: 'desktop_ocr_pair_response_invalid' });
		expect(credentialStore.store).not.toHaveBeenCalled();
		expect(saveMetadata).not.toHaveBeenCalled();
	});

	it('surfaces only a bounded safe backend error code on rejected pairing', async () => {
		const { credentialStore, saveMetadata } = dependencies();
		const error = await pairDesktopWorker(
			{
				workerEndpoint: WORKER_ENDPOINT,
				label: 'Desktop principal',
				capabilities: CAPABILITIES,
				accessToken: ACCESS_TOKEN,
				devicePath: DEVICE_PATH,
				credentialStore
			},
			{
				fetchImpl: vi.fn(async () => response({ code: 'desktop_ocr_forbidden' }, 403)),
				saveMetadata
			}
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(DesktopPairingError);
		expect(error).toMatchObject({ code: 'desktop_ocr_forbidden', httpStatus: 403 });
		expect(String(error)).not.toContain(ACCESS_TOKEN);
		expect(credentialStore.store).not.toHaveBeenCalled();
	});

	it('fails closed on non-HTTPS or non-worker endpoints before sending the browser session', async () => {
		const { credentialStore, saveMetadata } = dependencies();
		const fetchImpl = vi.fn();

		await expect(
			pairDesktopWorker(
				{
					workerEndpoint: 'http://127.0.0.1/functions/v1/desktop-ocr-worker',
					label: 'Desktop principal',
					capabilities: CAPABILITIES,
					accessToken: ACCESS_TOKEN,
					devicePath: DEVICE_PATH,
					credentialStore
				},
				{ fetchImpl, saveMetadata }
			)
		).rejects.toThrow('endpoint');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
