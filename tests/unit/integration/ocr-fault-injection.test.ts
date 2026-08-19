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
	if (incoming.headers['x-goog-api-key'] !== API_KEY) throw new Error('Gemini API key missing');
	const body = JSON.parse(await readBody(incoming)) as {
		generationConfig?: Record<string, unknown>;
	};
	if (body.generationConfig?.responseMimeType !== 'application/json')
		throw new Error('JSON required');
	switch (incoming.url) {
		case '/transient-rate-limit':
			response.writeHead(429);
			response.end('Rate limit exceeded');
			return;
		case '/daily-quota':
			response.writeHead(429);
			response.end('Requests per day quota exceeded');
			return;
		case '/service-unavailable':
			response.writeHead(503);
			response.end('Service unavailable');
			return;
		case '/invalid-payload':
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end('{');
			return;
		case '/timeout':
			setTimeout(() => {
				if (!response.destroyed) {
					response.writeHead(200);
					response.end('{}');
				}
			}, 250);
			return;
		default:
			response.writeHead(404);
			response.end('Unknown');
	}
}

function fetchScenario(path: string): typeof fetch {
	return ((input: string | URL | Request, init?: RequestInit) => {
		if (String(input).includes(API_KEY)) throw new Error('Gemini API key leaked into URL');
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
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	server.close();
	server.closeAllConnections();
	await once(server, 'close');
});

describe.sequential('local OCR provider fault injection', () => {
	it('classifies transient 429 as retryable rate limiting', async () => {
		expect(decision(await captureFailure('transient-rate-limit'), 1).persistence).toEqual(
			expect.objectContaining({
				kind: 'fail_job',
				code: 'gemini_rate_limited',
				retryable: true,
				nextRetryAt: '2026-08-03T00:01:00.000Z'
			})
		);
	});
	it('classifies provider daily quota separately', async () => {
		expect(decision(await captureFailure('daily-quota'), 1).persistence).toEqual({
			kind: 'block_quota',
			code: 'gemini_daily_quota',
			failedAt: FAILED_AT.toISOString()
		});
	});
	it('classifies 503 as retryable provider unavailability', async () => {
		expect(decision(await captureFailure('service-unavailable'), 1).persistence).toEqual(
			expect.objectContaining({
				code: 'gemini_service_unavailable',
				retryable: true,
				nextRetryAt: '2026-08-03T00:00:30.000Z'
			})
		);
	});
	it('bounds invalid provider payload retries', async () => {
		expect(decision(await captureFailure('invalid-payload'), 1).persistence).toEqual(
			expect.objectContaining({ code: 'ocr_response_invalid', retryable: true })
		);
		expect(decision(await captureFailure('invalid-payload'), 3).persistence).toEqual(
			expect.objectContaining({ code: 'ocr_response_invalid', retryable: false, nextRetryAt: null })
		);
	});
	it('bounds aborted request retries', async () => {
		const first = new AbortController();
		setTimeout(() => first.abort(), 25);
		expect(decision(await captureFailure('timeout', first.signal), 1).persistence).toEqual(
			expect.objectContaining({ code: 'ocr_request_failed', retryable: true })
		);
		const third = new AbortController();
		setTimeout(() => third.abort(), 25);
		expect(decision(await captureFailure('timeout', third.signal), 3).persistence).toEqual(
			expect.objectContaining({ code: 'ocr_request_failed', retryable: false, nextRetryAt: null })
		);
	});
});
