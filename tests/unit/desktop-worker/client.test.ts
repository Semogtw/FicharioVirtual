import { describe, expect, it, vi } from 'vitest';
import {
	DesktopWorkerApiError,
	DesktopWorkerClient
} from '../../../tools/desktop-worker/client.mjs';

const CREDENTIAL = 'A'.repeat(43);
const ENDPOINT = 'https://example.supabase.co/functions/v1/desktop-ocr-worker';
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_ID = '44444444-4444-4444-8444-444444444444';
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';
const RESULT_ID = '66666666-6666-4666-8666-666666666666';
const SOURCE_SHA = 'a'.repeat(64);

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

function lease() {
	return {
		jobId: JOB_ID,
		pageId: PAGE_ID,
		deviceId: DEVICE_ID,
		leaseId: LEASE_ID,
		leaseExpiresAt: '2026-08-10T01:30:00.000Z'
	};
}

function completionRequest() {
	return {
		action: 'complete',
		jobId: JOB_ID,
		leaseId: LEASE_ID,
		sourceSha256: SOURCE_SHA,
		backend: 'transformers',
		modelId: 'test-model',
		modelVersion: '1.0.0',
		rawText: 'synthetic transcript',
		correctedText: null,
		contentType: 'printed',
		warnings: [],
		needsReview: false,
		timingMs: 1000
	};
}

describe('DesktopWorkerClient', () => {
	it('validates the endpoint and credential before making requests', () => {
		expect(
			() => new DesktopWorkerClient({ endpoint: 'http://example.com/functions/v1/desktop-ocr-worker', credential: CREDENTIAL })
		).toThrow('endpoint');
		expect(() => new DesktopWorkerClient({ endpoint: ENDPOINT, credential: 'bad' })).toThrow(
			'credential'
		);
	});

	it('returns null when no desktop job is claimable', async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
		const client = new DesktopWorkerClient({ endpoint: ENDPOINT, credential: CREDENTIAL, fetchImpl });
		await expect(client.claim()).resolves.toBeNull();
		expect(fetchImpl).toHaveBeenCalledOnce();
		const [, init] = fetchImpl.mock.calls[0];
		expect(JSON.parse(String(init?.body))).toEqual({ action: 'claim' });
		expect(new Headers(init?.headers).get('Authorization')).toBe(`FicharioWorker ${CREDENTIAL}`);
	});

	it('parses a claim and binds renew responses to the same job and lease', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json(200, lease()))
			.mockResolvedValueOnce(json(200, lease()));
		const client = new DesktopWorkerClient({ endpoint: ENDPOINT, credential: CREDENTIAL, fetchImpl });
		await expect(client.claim()).resolves.toEqual(lease());
		await expect(client.renew(JOB_ID, LEASE_ID)).resolves.toEqual(lease());
	});

	it('parses only a bounded source response for the active lease', async () => {
		const body = {
			jobId: JOB_ID,
			pageId: PAGE_ID,
			documentId: DOCUMENT_ID,
			pageNumber: 1,
			leaseId: LEASE_ID,
			leaseExpiresAt: '2026-08-10T01:30:00.000Z',
			sourceUrl: 'https://example.supabase.co/storage/v1/object/sign/documents/test?token=signed',
			sourceUrlExpiresInSeconds: 60,
			sourceSha256: SOURCE_SHA,
			mimeType: 'image/webp',
			sourceBytes: 1024
		};
		const client = new DesktopWorkerClient({
			endpoint: ENDPOINT,
			credential: CREDENTIAL,
			fetchImpl: vi.fn(async () => json(200, body))
		});
		await expect(client.source(JOB_ID, LEASE_ID)).resolves.toEqual(body);
	});

	it('submits the exact completion contract and parses the terminal receipt', async () => {
		const receipt = {
			jobId: JOB_ID,
			pageId: PAGE_ID,
			resultId: RESULT_ID,
			status: 'ready',
			idempotentReplay: false,
			cleanupPending: false
		};
		const fetchImpl = vi.fn(async () => json(200, receipt));
		const client = new DesktopWorkerClient({ endpoint: ENDPOINT, credential: CREDENTIAL, fetchImpl });
		await expect(client.complete(completionRequest())).resolves.toEqual(receipt);
		const [, init] = fetchImpl.mock.calls[0];
		expect(JSON.parse(String(init?.body))).toEqual(completionRequest());
	});

	it('surfaces only safe provider-independent error codes', async () => {
		const fetchImpl = vi.fn(async () =>
			json(409, {
				code: 'desktop_ocr_lease_not_active',
				message: `do not expose ${CREDENTIAL}`,
				details: { authorization: CREDENTIAL }
			})
		);
		const client = new DesktopWorkerClient({ endpoint: ENDPOINT, credential: CREDENTIAL, fetchImpl });
		const error = await client.renew(JOB_ID, LEASE_ID).catch((caught) => caught);
		expect(error).toBeInstanceOf(DesktopWorkerApiError);
		expect(error.code).toBe('desktop_ocr_lease_not_active');
		expect(error.httpStatus).toBe(409);
		expect(String(error)).not.toContain(CREDENTIAL);
	});

	it('rejects malformed success bodies instead of trusting the server blindly', async () => {
		const client = new DesktopWorkerClient({
			endpoint: ENDPOINT,
			credential: CREDENTIAL,
			fetchImpl: vi.fn(async () => json(200, { ...lease(), unexpected: true }))
		});
		await expect(client.claim()).rejects.toMatchObject({ code: 'worker_response_invalid' });
	});
});
