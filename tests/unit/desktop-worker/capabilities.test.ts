import { describe, expect, it } from 'vitest';
import {
	WORKER_PROTOCOL_VERSION,
	buildWorkerCapabilities
} from '../../../tools/desktop-worker/capabilities.mjs';

describe('buildWorkerCapabilities', () => {
	it('derives a closed non-secret capability summary from validated local state', () => {
		const result = buildWorkerCapabilities(
			{ maxConcurrency: 1 },
			{
				backend: 'ollama',
				model: 'qwen3-vl:4b',
				digest: 'a'.repeat(64)
			}
		);

		expect(result).toEqual({
			protocolVersion: WORKER_PROTOCOL_VERSION,
			backend: 'ollama',
			model: 'qwen3-vl:4b',
			modelDigest: 'a'.repeat(64),
			maxConcurrency: 1
		});
		expect(Object.isFrozen(result)).toBe(true);
	});

	it('rejects unsupported or mutable model metadata', () => {
		expect(() =>
			buildWorkerCapabilities(
				{ maxConcurrency: 1 },
				{ backend: 'cloud', model: 'remote', digest: 'a'.repeat(64) }
			)
		).toThrow('model lock');
		expect(() =>
			buildWorkerCapabilities(
				{ maxConcurrency: 1 },
				{ backend: 'ollama', model: 'qwen3-vl:latest', digest: 'latest' }
			)
		).toThrow('model lock');
	});

	it('rejects unsafe concurrency values instead of advertising impossible capacity', () => {
		for (const maxConcurrency of [0, 9, 1.5]) {
			expect(() =>
				buildWorkerCapabilities(
					{ maxConcurrency },
					{ backend: 'ollama', model: 'qwen3-vl:4b', digest: 'a'.repeat(64) }
				)
			).toThrow('config');
		}
	});
});
