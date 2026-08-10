import { describe, expect, it, vi } from 'vitest';
import { checkWorkerPreflight } from '../../../tools/desktop-worker/preflight.mjs';

describe('checkWorkerPreflight', () => {
	it('allows service startup only after a ready local doctor result', async () => {
		const doctor = vi.fn(async () => ({ ready: true, ollama: { state: 'ready', code: null } }));
		await expect(checkWorkerPreflight({ doctor })).resolves.toEqual({ ready: true, code: null });
	});

	it('preserves only a sanitized actionable Ollama preflight code', async () => {
		const doctor = vi.fn(async () => ({
			ready: false,
			ollama: { state: 'failed', code: 'ollama_model_digest_mismatch' }
		}));
		await expect(checkWorkerPreflight({ doctor })).resolves.toEqual({
			ready: false,
			code: 'ollama_model_digest_mismatch'
		});
	});

	it('uses a generic code for missing local state or unsafe doctor codes', async () => {
		await expect(
			checkWorkerPreflight({
				doctor: vi.fn(async () => ({
					ready: false,
					ollama: { state: 'not_checked', code: null }
				}))
			})
		).resolves.toEqual({ ready: false, code: 'worker_preflight_not_ready' });

		await expect(
			checkWorkerPreflight({
				doctor: vi.fn(async () => ({
					ready: false,
					ollama: { state: 'failed', code: 'BAD CODE /private/path' }
				}))
			})
		).resolves.toEqual({ ready: false, code: 'worker_preflight_not_ready' });
	});
});
