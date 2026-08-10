import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createLockedOcrEngine,
	loadModelLock,
	modelLockPath,
	parseModelLock,
	saveModelLock
} from '../../../tools/desktop-worker/model-lock.mjs';

const DIGEST = 'a'.repeat(64);
const roots: string[] = [];

async function fixture() {
	const configDir = await mkdtemp(join(tmpdir(), 'fichario-worker-model-'));
	roots.push(configDir);
	return { configDir };
}

function lock(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		backend: 'ollama',
		model: 'qwen3-vl:4b',
		digest: DIGEST,
		...overrides
	};
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('desktop worker model lock', () => {
	it('persists a strict non-secret model pin with private permissions', async () => {
		const paths = await fixture();
		const path = modelLockPath(paths);
		await saveModelLock(path, lock());
		await expect(loadModelLock(path)).resolves.toEqual(lock());
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it('rejects widened shapes, mutable missing digests and unsupported backends', () => {
		expect(() => parseModelLock({ ...lock(), token: 'forbidden' })).toThrow('shape');
		expect(() => parseModelLock(lock({ digest: 'latest' }))).toThrow('digest');
		expect(() => parseModelLock(lock({ backend: 'cloud' }))).toThrow('backend');
		expect(() => parseModelLock(lock({ schemaVersion: 2 }))).toThrow('schemaVersion');
	});

	it('builds the OCR engine from the pinned digest without copying it into general config', async () => {
		const paths = await fixture();
		await saveModelLock(modelLockPath(paths), lock());
		const fetchImpl = vi.fn();
		const engine = await createLockedOcrEngine(paths, { fetchImpl });
		expect(engine).toHaveProperty('process');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
