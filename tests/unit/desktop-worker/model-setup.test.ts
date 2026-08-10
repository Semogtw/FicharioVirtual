import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ModelSetupError,
	discoverLocalOllamaModel,
	lockLocalOllamaModel
} from '../../../tools/desktop-worker/model-setup.mjs';
import { resolveWorkerPaths } from '../../../tools/desktop-worker/paths.mjs';

const MODEL = 'qwen3-vl:4b';
const DIGEST = 'a'.repeat(64);
const roots: string[] = [];

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('discoverLocalOllamaModel', () => {
	it('pins the exact digest only after confirming the model is local and vision-capable', async () => {
		const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
			const path = new URL(String(url)).pathname;
			if (path === '/api/tags') {
				return json({ models: [{ name: MODEL, model: MODEL, digest: DIGEST }] });
			}
			if (path === '/api/show') {
				expect(JSON.parse(String(init?.body))).toEqual({ model: MODEL, verbose: false });
				return json({ capabilities: ['completion', 'vision'] });
			}
			throw new Error(`unexpected path ${path}`);
		});

		const result = await discoverLocalOllamaModel(MODEL, { fetchImpl });

		expect(result).toEqual({
			schemaVersion: 1,
			backend: 'ollama',
			model: MODEL,
			digest: DIGEST
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		for (const [url, init] of fetchImpl.mock.calls) {
			expect(new URL(String(url)).origin).toBe('http://127.0.0.1:11434');
			expect(init?.redirect).toBe('error');
		}
	});

	it('rejects remote-backed model entries before accepting a lock', async () => {
		const fetchImpl = vi.fn(async () =>
			json({
				models: [
					{
						name: MODEL,
						model: MODEL,
						digest: DIGEST,
						remote_model: 'cloud/model',
						remote_host: 'https://ollama.com'
					}
				]
			})
		);

		await expect(discoverLocalOllamaModel(MODEL, { fetchImpl })).rejects.toMatchObject({
			code: 'ollama_remote_model_forbidden'
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('rejects mutable or malformed digests and non-vision models', async () => {
		await expect(
			discoverLocalOllamaModel(MODEL, {
				fetchImpl: vi.fn(async () => json({ models: [{ name: MODEL, digest: 'latest' }] }))
			})
		).rejects.toMatchObject({ code: 'ollama_model_digest_invalid' });

		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ models: [{ name: MODEL, digest: DIGEST }] }))
			.mockResolvedValueOnce(json({ capabilities: ['completion'] }));
		await expect(discoverLocalOllamaModel(MODEL, { fetchImpl })).rejects.toMatchObject({
			code: 'ollama_model_not_vision'
		});
	});

	it('refuses non-loopback model setup endpoints', async () => {
		const fetchImpl = vi.fn();
		await expect(
			discoverLocalOllamaModel(MODEL, {
				baseUrl: 'http://192.168.1.5:11434/',
				fetchImpl
			})
		).rejects.toThrow('loopback');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe('lockLocalOllamaModel', () => {
	it('creates private worker directories and persists only the discovered immutable lock', async () => {
		const root = await mkdtemp(join(tmpdir(), 'fichario-worker-model-setup-'));
		roots.push(root);
		const paths = resolveWorkerPaths(
			{
				XDG_CONFIG_HOME: join(root, 'config'),
				XDG_CACHE_HOME: join(root, 'cache'),
				XDG_STATE_HOME: join(root, 'state')
			},
			join(root, 'home')
		);
		const lock = {
			schemaVersion: 1,
			backend: 'ollama',
			model: MODEL,
			digest: DIGEST
		};
		const discover = vi.fn(async () => lock);
		const saveLock = vi.fn(async (_path, value) => value);

		const result = await lockLocalOllamaModel(MODEL, { paths, discover, saveLock });

		expect(result).toEqual(lock);
		expect(discover).toHaveBeenCalledWith(MODEL, {
			baseUrl: 'http://127.0.0.1:11434/',
			fetchImpl: expect.any(Function),
			signal: undefined
		});
		expect(saveLock).toHaveBeenCalledWith(join(paths.configDir, 'model.json'), lock);
	});

	it('uses a safe typed error for unavailable local Ollama', async () => {
		const error = await discoverLocalOllamaModel(MODEL, {
			fetchImpl: vi.fn(async () => {
				throw new Error('socket path and private details');
			})
		}).catch((caught) => caught);
		expect(error).toBeInstanceOf(ModelSetupError);
		expect(error.code).toBe('ollama_unavailable');
		expect(String(error)).not.toContain('socket path');
	});
});
