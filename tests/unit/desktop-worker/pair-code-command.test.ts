import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	pairFromLocalStateWithCode,
	readPairingCode,
	runPairCodeCli
} from '../../../tools/desktop-worker/pair-code-command.mjs';
import { resolveWorkerPaths } from '../../../tools/desktop-worker/paths.mjs';

const PAIRING_CODE = 'ABCD-1234-EF56-7890';
const WORKER_ENDPOINT = 'https://example.supabase.co/functions/v1/desktop-ocr-worker';
const roots: string[] = [];

function sink() {
	let value = '';
	return {
		write(chunk: unknown) {
			value += String(chunk);
			return true;
		},
		read: () => value
	};
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('readPairingCode', () => {
	it('reads and normalizes exactly one piped pairing code line', async () => {
		const input = Readable.from([`${PAIRING_CODE.toLowerCase()}\n`]);
		await expect(readPairingCode(input, sink())).resolves.toBe(PAIRING_CODE);
	});

	it('rejects multiline or malformed piped input', async () => {
		await expect(
			readPairingCode(Readable.from([`${PAIRING_CODE}\nsecond-line\n`]), sink())
		).rejects.toThrow('one line');
		await expect(readPairingCode(Readable.from(['wrong\n']), sink())).rejects.toThrow(
			'pairing code'
		);
	});
});

describe('pairFromLocalStateWithCode', () => {
	it('derives capabilities from local config/model state before redeeming the code', async () => {
		const root = await mkdtemp(join(tmpdir(), 'fichario-worker-pair-code-cli-'));
		roots.push(root);
		const paths = resolveWorkerPaths(
			{
				XDG_CONFIG_HOME: join(root, 'config'),
				XDG_CACHE_HOME: join(root, 'cache'),
				XDG_STATE_HOME: join(root, 'state')
			},
			join(root, 'home')
		);
		const credentialStore = { store: vi.fn(), clear: vi.fn() };
		const pair = vi.fn(async (request) => ({ deviceId: 'safe-device', label: request.label }));

		const result = await pairFromLocalStateWithCode(
			{
				workerEndpoint: WORKER_ENDPOINT,
				label: 'Desktop principal',
				pairingCode: PAIRING_CODE,
				paths,
				credentialStore
			},
			{
				loadConfig: vi.fn(async () => ({ maxConcurrency: 1 })),
				loadLock: vi.fn(async () => ({
					backend: 'ollama',
					model: 'qwen3-vl:4b',
					digest: 'a'.repeat(64)
				})),
				pair
			}
		);

		expect(pair).toHaveBeenCalledWith({
			workerEndpoint: WORKER_ENDPOINT,
			label: 'Desktop principal',
			pairingCode: PAIRING_CODE,
			devicePath: paths.devicePath,
			credentialStore,
			capabilities: {
				protocolVersion: 1,
				backend: 'ollama',
				model: 'qwen3-vl:4b',
				modelDigest: 'a'.repeat(64),
				maxConcurrency: 1
			}
		});
		expect(result).toEqual({ deviceId: 'safe-device', label: 'Desktop principal' });
	});
});

describe('runPairCodeCli', () => {
	it('keeps the pairing code out of argv and prints only the safe device receipt', async () => {
		const stdout = sink();
		const stderr = sink();
		const pairLocal = vi.fn(async ({ pairingCode }) => {
			expect(pairingCode).toBe(PAIRING_CODE);
			return {
				deviceId: '11111111-1111-4111-8111-111111111111',
				label: 'Desktop principal',
				status: 'active',
				createdAt: '2026-08-10T04:45:00.000Z'
			};
		});

		const exitCode = await runPairCodeCli([WORKER_ENDPOINT, 'Desktop principal'], {
			input: Readable.from([]),
			stdout,
			stderr,
			readCode: vi.fn(async () => PAIRING_CODE),
			pairLocal
		});

		expect(exitCode).toBe(0);
		expect(stdout.read()).toContain('"status":"active"');
		expect(stdout.read()).not.toContain(PAIRING_CODE);
		expect(stderr.read()).toBe('');
	});

	it('prints only a sanitized error code', async () => {
		const stdout = sink();
		const stderr = sink();
		const error = Object.assign(new Error(`private ${PAIRING_CODE}`), {
			code: 'desktop_ocr_pairing_code_unavailable'
		});
		const exitCode = await runPairCodeCli([WORKER_ENDPOINT, 'Desktop principal'], {
			input: Readable.from([]),
			stdout,
			stderr,
			readCode: vi.fn(async () => PAIRING_CODE),
			pairLocal: vi.fn(async () => {
				throw error;
			})
		});
		expect(exitCode).toBe(1);
		expect(stdout.read()).toBe('');
		expect(stderr.read()).toContain('desktop_ocr_pairing_code_unavailable');
		expect(stderr.read()).not.toContain(PAIRING_CODE);
	});

	it('rejects unexpected argv before reading any pairing code', async () => {
		const readCode = vi.fn();
		const stderr = sink();
		const exitCode = await runPairCodeCli([WORKER_ENDPOINT, 'Desktop', PAIRING_CODE], {
			input: Readable.from([]),
			stdout: sink(),
			stderr,
			readCode,
			pairLocal: vi.fn()
		});
		expect(exitCode).toBe(2);
		expect(readCode).not.toHaveBeenCalled();
		expect(stderr.read()).not.toContain(PAIRING_CODE);
	});
});
