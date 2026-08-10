import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	OllamaEngineError,
	OllamaOcrEngine
} from '../../../tools/desktop-worker/ollama-engine.mjs';

const MODEL = 'gemma3:4b';
const DIGEST = 'a'.repeat(64);
const roots: string[] = [];

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

async function source(bytes = Buffer.from('synthetic-image-bytes')) {
	const root = await mkdtemp(join(tmpdir(), 'fichario-worker-ollama-'));
	roots.push(root);
	const path = join(root, 'source.webp');
	await writeFile(path, bytes, { mode: 0o600 });
	return {
		path,
		bytes: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		mimeType: 'image/webp'
	};
}

function tags(overrides: Record<string, unknown> = {}) {
	return {
		models: [
			{
				name: MODEL,
				model: MODEL,
				digest: DIGEST,
				...overrides
			}
		]
	};
}

function chatContent(overrides: Record<string, unknown> = {}) {
	return {
		rawText: 'Texto sintético',
		contentType: 'printed',
		warnings: [],
		needsReview: false,
		...overrides
	};
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('OllamaOcrEngine', () => {
	it('accepts only a loopback Ollama HTTP endpoint', () => {
		expect(() =>
			new OllamaOcrEngine({
				model: MODEL,
				expectedDigest: DIGEST,
				baseUrl: 'https://ollama.com/'
			})
		).toThrow('loopback');
		expect(() =>
			new OllamaOcrEngine({
				model: MODEL,
				expectedDigest: DIGEST,
				baseUrl: 'http://192.168.1.2:11434/'
			})
		).toThrow('loopback');
	});

	it('verifies the local digest and vision capability before sending private image bytes', async () => {
		const input = await source();
		const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
			const path = new URL(String(url)).pathname;
			if (path === '/api/tags') return json(tags());
			if (path === '/api/show') return json({ capabilities: ['completion', 'vision'] });
			if (path === '/api/chat') {
				const request = JSON.parse(String(init?.body));
				expect(request.model).toBe(MODEL);
				expect(request.stream).toBe(false);
				expect(request.think).toBe(false);
				expect(request.options).toEqual({ temperature: 0 });
				expect(request.format).toMatchObject({
					type: 'object',
					additionalProperties: false
				});
				expect(request.messages[0].images).toEqual([
					Buffer.from('synthetic-image-bytes').toString('base64')
				]);
				return json({
					done: true,
					message: { role: 'assistant', content: JSON.stringify(chatContent()) }
				});
			}
			throw new Error(`unexpected path ${path}`);
		});
		const engine = new OllamaOcrEngine({ model: MODEL, expectedDigest: DIGEST, fetchImpl });

		const result = await engine.process(input);

		expect(result).toMatchObject({
			backend: 'ollama',
			modelId: MODEL,
			modelVersion: `sha256:${DIGEST}`,
			rawText: 'Texto sintético',
			correctedText: null,
			contentType: 'printed',
			warnings: [],
			needsReview: false
		});
		expect(result.timingMs).toBeGreaterThanOrEqual(0);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		for (const [, init] of fetchImpl.mock.calls) expect(init?.redirect).toBe('error');
	});

	it('maps constrained OCR warning codes to fixed local messages', async () => {
		const input = await source();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json(tags()))
			.mockResolvedValueOnce(json({ capabilities: ['vision'] }))
			.mockResolvedValueOnce(
				json({
					done: true,
					message: {
						role: 'assistant',
						content: JSON.stringify(
							chatContent({ warnings: ['uncertain_characters'], needsReview: true })
						)
					}
				})
			);
		const engine = new OllamaOcrEngine({ model: MODEL, expectedDigest: DIGEST, fetchImpl });

		const result = await engine.process(input);

		expect(result.warnings).toEqual([
			{
				code: 'uncertain_characters',
				message: 'Há caracteres cuja leitura pode estar incorreta.'
			}
		]);
		expect(result.needsReview).toBe(true);
	});

	it('rejects a changed model digest before any image is sent to chat', async () => {
		const input = await source();
		const fetchImpl = vi.fn(async () => json(tags({ digest: 'b'.repeat(64) })));
		const engine = new OllamaOcrEngine({ model: MODEL, expectedDigest: DIGEST, fetchImpl });

		await expect(engine.process(input)).rejects.toMatchObject({
			code: 'ollama_model_digest_mismatch'
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('rejects Ollama cloud-backed model entries before private image transmission', async () => {
		const input = await source();
		const fetchImpl = vi.fn(async () =>
			json(tags({ remote_model: 'cloud/model', remote_host: 'https://ollama.com' }))
		);
		const engine = new OllamaOcrEngine({ model: MODEL, expectedDigest: DIGEST, fetchImpl });

		await expect(engine.process(input)).rejects.toMatchObject({
			code: 'ollama_remote_model_forbidden'
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('rejects non-vision models before reading the source into an inference request', async () => {
		const input = await source();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json(tags()))
			.mockResolvedValueOnce(json({ capabilities: ['completion'] }));
		const engine = new OllamaOcrEngine({ model: MODEL, expectedDigest: DIGEST, fetchImpl });

		await expect(engine.process(input)).rejects.toMatchObject({ code: 'ollama_model_not_vision' });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('rechecks the downloaded source digest immediately before inference', async () => {
		const original = Buffer.from('same-size-original');
		const input = await source(original);
		await writeFile(input.path, Buffer.from('same-size-tampered'));
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json(tags()))
			.mockResolvedValueOnce(json({ capabilities: ['vision'] }));
		const engine = new OllamaOcrEngine({ model: MODEL, expectedDigest: DIGEST, fetchImpl });

		await expect(engine.process(input)).rejects.toMatchObject({ code: 'ollama_source_changed' });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('rejects malformed structured output instead of coercing or widening it', async () => {
		const input = await source();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json(tags()))
			.mockResolvedValueOnce(json({ capabilities: ['vision'] }))
			.mockResolvedValueOnce(
				json({
					done: true,
					message: {
						role: 'assistant',
						content: JSON.stringify(
							chatContent({ warnings: ['uncertain_characters'], needsReview: false })
						)
					}
				})
			);
		const engine = new OllamaOcrEngine({ model: MODEL, expectedDigest: DIGEST, fetchImpl });
		const error = await engine.process(input).catch((caught) => caught);
		expect(error).toBeInstanceOf(OllamaEngineError);
		expect(error.code).toBe('ollama_ocr_invalid');
	});

	it('revalidates the model digest on every page while caching immutable vision capability', async () => {
		const first = await source(Buffer.from('first-image'));
		const second = await source(Buffer.from('second-image'));
		const fetchImpl = vi.fn(async (url: URL | string) => {
			const path = new URL(String(url)).pathname;
			if (path === '/api/tags') return json(tags());
			if (path === '/api/show') return json({ capabilities: ['vision'] });
			if (path === '/api/chat') {
				return json({
					done: true,
					message: { role: 'assistant', content: JSON.stringify(chatContent()) }
				});
			}
			throw new Error('unexpected request');
		});
		const engine = new OllamaOcrEngine({ model: MODEL, expectedDigest: DIGEST, fetchImpl });

		await engine.process(first);
		await engine.process(second);

		const paths = fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname);
		expect(paths.filter((path) => path === '/api/tags')).toHaveLength(2);
		expect(paths.filter((path) => path === '/api/show')).toHaveLength(1);
		expect(paths.filter((path) => path === '/api/chat')).toHaveLength(2);
	});
});
