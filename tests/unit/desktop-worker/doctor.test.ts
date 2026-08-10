import { describe, expect, it, vi } from 'vitest';
import { runWorkerDoctor } from '../../../tools/desktop-worker/doctor.mjs';

function readyStatus() {
	return {
		readyToRun: true,
		config: { state: 'ready', appOrigin: 'https://app.example.com' },
		device: {
			state: 'ready',
			label: 'Desktop principal',
			workerEndpoint: 'https://example.supabase.co/functions/v1/desktop-ocr-worker'
		},
		model: {
			state: 'ready',
			backend: 'ollama',
			model: 'qwen3-vl:4b',
			digest: 'a'.repeat(64)
		},
		credential: { state: 'ready' },
		spool: { state: 'missing', pending: 0, accepted: 0, rejected: 0, rejectionReasons: {} }
	};
}

describe('runWorkerDoctor', () => {
	it('does not touch Ollama until all required local state is ready', async () => {
		const discoverModel = vi.fn();
		const result = await runWorkerDoctor(
			{},
			{
				inspectStatus: vi.fn(async () => ({
					...readyStatus(),
					readyToRun: false,
					credential: { state: 'missing' }
				})),
				discoverModel
			}
		);

		expect(result).toEqual({
			ready: false,
			localState: {
				config: 'ready',
				device: 'ready',
				model: 'ready',
				credential: 'missing'
			},
			ollama: { state: 'not_checked', code: null }
		});
		expect(discoverModel).not.toHaveBeenCalled();
	});

	it('returns ready only when the loopback model is local, vision-capable and matches the pinned digest', async () => {
		const fetchImpl = vi.fn();
		const discoverModel = vi.fn(async (_model, options) => {
			expect(options.baseUrl).toBe('http://127.0.0.1:11434/');
			expect(options.fetchImpl).toBe(fetchImpl);
			return {
				schemaVersion: 1,
				backend: 'ollama',
				model: 'qwen3-vl:4b',
				digest: 'a'.repeat(64)
			};
		});

		const result = await runWorkerDoctor(
			{},
			{ inspectStatus: vi.fn(async () => readyStatus()), discoverModel, fetchImpl }
		);

		expect(result).toEqual({
			ready: true,
			localState: {
				config: 'ready',
				device: 'ready',
				model: 'ready',
				credential: 'ready'
			},
			ollama: {
				state: 'ready',
				code: null,
				model: 'qwen3-vl:4b',
				digest: 'a'.repeat(64)
			}
		});
	});

	it('fails closed when the currently installed model digest differs from model.json', async () => {
		const result = await runWorkerDoctor(
			{},
			{
				inspectStatus: vi.fn(async () => readyStatus()),
				discoverModel: vi.fn(async () => ({
					schemaVersion: 1,
					backend: 'ollama',
					model: 'qwen3-vl:4b',
					digest: 'b'.repeat(64)
				}))
			}
		);

		expect(result.ready).toBe(false);
		expect(result.ollama).toEqual({
			state: 'failed',
			code: 'ollama_model_digest_mismatch'
		});
	});

	it('surfaces only safe local Ollama error codes and never the original private error message', async () => {
		const privateError = Object.assign(new Error('/home/user/private/model path'), {
			code: 'ollama_model_not_vision'
		});
		const result = await runWorkerDoctor(
			{},
			{
				inspectStatus: vi.fn(async () => readyStatus()),
				discoverModel: vi.fn(async () => {
					throw privateError;
				})
			}
		);

		expect(result.ready).toBe(false);
		expect(result.ollama).toEqual({ state: 'failed', code: 'ollama_model_not_vision' });
		expect(JSON.stringify(result)).not.toContain('/home/user/private/model path');
	});

	it('replaces unsafe error codes with a generic preflight code', async () => {
		const privateError = Object.assign(new Error('private details'), {
			code: 'BAD CODE / secret'
		});
		const result = await runWorkerDoctor(
			{},
			{
				inspectStatus: vi.fn(async () => readyStatus()),
				discoverModel: vi.fn(async () => {
					throw privateError;
				})
			}
		);
		expect(result.ollama).toEqual({ state: 'failed', code: 'ollama_preflight_failed' });
	});
});
