import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planOcrFailure } from '../../../supabase/functions/_shared/ocr-failure';
import { requestGeminiOcr } from '../../../supabase/functions/_shared/gemini-ocr-client';

const API_KEY = 'fault-test-key';
const FAILED_AT = new Date('2026-08-03T00:00:00.000Z');
const request = {
	apiKey: API_KEY,
	model: 'gemini-fault-test',
	mimeType: 'image/png',
	bytes: new Uint8Array([1, 2, 3]),
	promptVersion: 1
};

let origin = '';
const server = createServer((incoming, response) => {
	void handleRequest(incoming, response).catch((error) => {
		if (!response.headersSent) response.writeHead(418, { 'Content-Type': 'text/plain' });
		response.end(error instanceof Error ? error.message : String(error));
	});
});

async function readBody(incoming: IncomingMessage): Promise<string> {
	incoming.setEncoding('utf8');
	let body = '';
	for await (const chunk of incoming) body += chunk;
	return body;
}

async function handleRequest(incoming: IncomingMessage, response: ServerResponse) {
	if (incoming.method !== 'POST') throw new Error('fault server requires POST');
	if (incoming.headers['x-goog-api-key'] !== API_KEY) {
		throw new Error('Gemini API key was not supplied through the expected header');
	}
	if (!String(incoming.headers['content-type']).startsWith('application/json')) {
		throw new Error('Gemini request must be JSON');
	}
	const body = JSON.parse(await readBody(incoming)) as {
		contents?: Array<{ parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }>;
		generationConfig?: { responseMimeType?: string; responseJsonSchema?: unknown };
	};
	if (body.contents?.[0]?.parts?.[0]?.inlineData?.data !== 'AQID') {
		throw new Error('Gemini request did not contain the expected image bytes');
	}
	if (
		body.generationConfig?.responseMimeType !== 'application/json' ||
		body.generationConfig.responseJsonSchema === undefined
	) {
		throw new Error('Gemini request did not require structured JSON output');
	}

	switch (incoming.url) {
		case '/transient-rate-limit':
			response.writeHead(429, { 'Content-Type': 'text/plain' });
			response.end('Rate limit exceeded');
			return;
		case '/daily-quota':
			response.writeHead(429, { 'Content-Type': 'text/plain' });
			response.end('Requests per day quota exceeded');
			return;
		case '/service-unavailable':
			response.writeHead(503, { 'Content-Type': 'text/plain' });
			response.end('Service unavailable');
			return;
		case '/invalid-payload':
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end('{');
			return;
		case '/timeout':
			setTimeout(() => {
				if (response.destroyed) return;
				response.writeHead(200, { 'Content-Type': 'application/json' });
				response.end('{}');
			}, 250);
			return;
		default:
			response.writeHead(404, { 'Content-Type': 'text/plain' });
			response.end('Unknown fault scenario');
	}
}

function fetchScenario(path: string): typeof fetch {
	return ((input: string | URL | Request, init?: RequestInit) => {
		const providerUrl = String(input);
		if (providerUrl.includes(API_KEY)) {
			throw new Error('Gemini API key leaked into the provider URL');
		}
		return fetch(`${origin}/${path}`, init);
	}) as typeof fetch;
}

async function captureFailure(path: string, signal?: AbortSignal): Promise<unknown> {
	try {
		await requestGeminiOcr({ ...request, signal, fetchImpl: fetchScenario(path) });
		throw new Error(`fault scenario ${path} unexpectedly succeeded`);
	} catch (error) {
		return error;
	}
}

function decision(error: unknown, attemptCount: number) {
	return planOcrFailure(error, { attemptCount, failedAt: FAILED_AT, jitterMs: 0 });
}

beforeAll(async () => {
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address() as AddressInfo;
	origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
	server.close();
	server.closeAllConnections();
	await once(server, 'close');
});

describe.sequential('local OCR provider fault injection', () => {
	it('classifies transient 429 as retryable rate limiting', async () => {
		const result = decision(await captureFailure('transient-rate-limit'), 1);

		expect(result.persistence).toEqual(
			expect.objectContaining({
				kind: 'fail_job',
				code: 'gemini_rate_limited',
				retryable: true,
				nextRetryAt: '2026-08-03T00:01:00.000Z'
			})
		);
		expect(result.response).toEqual({ status: 202, body: { state: 'retry_later' } });
	});

	it('classifies provider daily quota separately from transient 429', async () => {
		const result = decision(await captureFailure('daily-quota'), 1);

		expect(result.persistence).toEqual({
			kind: 'block_quota',
			code: 'gemini_daily_quota',
			failedAt: FAILED_AT.toISOString()
		});
		expect(result.response).toEqual({ status: 202, body: { state: 'quota_exhausted' } });
	});

	it('classifies 503 as retryable provider unavailability', async () => {
		const result = decision(await captureFailure('service-unavailable'), 1);

		expect(result.persistence).toEqual(
			expect.objectContaining({
				kind: 'fail_job',
				code: 'gemini_service_unavailable',
				retryable: true,
				nextRetryAt: '2026-08-03T00:00:30.000Z'
			})
		);
	});

	it('retries an invalid provider payload before the third attempt', async () => {
		const result = decision(await captureFailure('invalid-payload'), 1);

		expect(result.persistence).toEqual(
			expect.objectContaining({
				code: 'ocr_response_invalid',
				retryable: true,
				nextRetryAt: '2026-08-03T00:00:45.000Z'
			})
		);
		expect(result.response.status).toBe(202);
	});

	it('terminates an invalid provider payload on the third attempt', async () => {
		const result = decision(await captureFailure('invalid-payload'), 3);

		expect(result.persistence).toEqual(
			expect.objectContaining({
				code: 'ocr_response_invalid',
				retryable: false,
				nextRetryAt: null
			})
		);
		expect(result.response).toEqual({
			status: 422,
			body: { code: 'ocr_response_invalid', retryable: false }
		});
	});

	it('retries a real aborted HTTP request before the third attempt', async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 25);
		const error = await captureFailure('timeout', controller.signal);
		clearTimeout(timeout);
		const result = decision(error, 1);

		expect(result.persistence).toEqual(
			expect.objectContaining({
				code: 'ocr_request_failed',
				retryable: true,
				nextRetryAt: '2026-08-03T00:00:45.000Z'
			})
		);
		expect(result.response.status).toBe(202);
	});

	it('terminates a real aborted HTTP request on the third attempt', async () => {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 25);
		const error = await captureFailure('timeout', controller.signal);
		clearTimeout(timeout);
		const result = decision(error, 3);

		expect(result.persistence).toEqual(
			expect.objectContaining({
				code: 'ocr_request_failed',
				retryable: false,
				nextRetryAt: null
			})
		);
		expect(result.response).toEqual({
			status: 503,
			body: { code: 'ocr_request_failed', retryable: false }
		});
	});
});
