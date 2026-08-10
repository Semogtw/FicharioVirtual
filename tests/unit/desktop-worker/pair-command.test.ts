import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	pairFromLocalState,
	readBrowserAccessToken,
	runPairCli
} from '../../../tools/desktop-worker/pair-command.mjs';
import { resolveWorkerPaths } from '../../../tools/desktop-worker/paths.mjs';

const ACCESS_TOKEN = 'header.payload.signature';
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

describe('readBrowserAccessToken', () => {
	it('reads exactly one piped line without writing the secret to output', async () => {
		const input = Readable.from([`${ACCESS_TOKEN}\n`]);
		const output = sink();
		await expect(readBrowserAccessToken(input, output)).resolves.toBe(ACCESS_TOKEN);
		expect(output.read()).toBe('');
	});

	it('rejects multiline piped input', async () => {
		const input = Readable.from([`${ACCESS_TOKEN}\nsecond.line.value\n`]);
		await expect(readBrowserAccessToken(input, sink())).rejects.toThrow('one line');
	});

	it('uses raw TTY mode and never echoes typed token characters', async () => {
		const input = new PassThrough() as PassThrough & {
			isTTY: boolean;
			setRawMode: ReturnType<typeof vi.fn>;
		};
		input.isTTY = true;
		input.setRawMode = vi.fn();
		const output = sink();
		const reading = readBrowserAccessToken(input, output);
		input.write(`${ACCESS_TOKEN}\r`);

		await expect(reading).resolves.toBe(ACCESS_TOKEN);
		expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
		expect(input.setRawMode).toHaveBeenLastCalledWith(false);
		expect(output.read()).toContain('Browser session access token:');
		expect(output.read()).not.toContain(ACCESS_TOKEN);
	});
});

describe('pairFromLocalState', () => {
	it('derives capabilities from local config/model state before pairing', async () => {
		const root = await mkdtemp(join(tmpdir(), 'fichario-worker-pair-cli-'));
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

		const result = await pairFromLocalState(
			{
				workerEndpoint: WORKER_ENDPOINT,
				label: 'Desktop principal',
				accessToken: ACCESS_TOKEN,
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
			accessToken: ACCESS_TOKEN,
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

describe('runPairCli', () => {
	it('keeps the token out of argv and prints only the safe pairing receipt', async () => {
		const stdout = sink();
		const stderr = sink();
		const pairLocal = vi.fn(async ({ accessToken }) => {
			expect(accessToken).toBe(ACCESS_TOKEN);
			return {
				deviceId: '11111111-1111-4111-8111-111111111111',
				label: 'Desktop principal',
				status: 'active',
				createdAt: '2026-08-10T02:30:00.000Z'
			};
		});

		const exitCode = await runPairCli([WORKER_ENDPOINT, 'Desktop principal'], {
			input: Readable.from([]),
			stdout,
			stderr,
			readToken: vi.fn(async () => ACCESS_TOKEN),
			pairLocal
		});

		expect(exitCode).toBe(0);
		expect(stdout.read()).toContain('"status":"active"');
		expect(stdout.read()).not.toContain(ACCESS_TOKEN);
		expect(stderr.read()).toBe('');
	});

	it('prints only a sanitized failure code even when an exception message contains secret material', async () => {
		const stdout = sink();
		const stderr = sink();
		const error = Object.assign(new Error(`failed with ${ACCESS_TOKEN}`), {
			code: 'desktop_ocr_pair_network_failed'
		});

		const exitCode = await runPairCli([WORKER_ENDPOINT, 'Desktop principal'], {
			input: Readable.from([]),
			stdout,
			stderr,
			readToken: vi.fn(async () => ACCESS_TOKEN),
			pairLocal: vi.fn(async () => {
				throw error;
			})
		});

		expect(exitCode).toBe(1);
		expect(stdout.read()).toBe('');
		expect(stderr.read()).toContain('desktop_ocr_pair_network_failed');
		expect(stderr.read()).not.toContain(ACCESS_TOKEN);
	});

	it('rejects unexpected argv before reading any token', async () => {
		const readToken = vi.fn();
		const stderr = sink();
		const exitCode = await runPairCli([WORKER_ENDPOINT, 'Desktop', ACCESS_TOKEN], {
			input: Readable.from([]),
			stdout: sink(),
			stderr,
			readToken,
			pairLocal: vi.fn()
		});
		expect(exitCode).toBe(2);
		expect(readToken).not.toHaveBeenCalled();
		expect(stderr.read()).not.toContain(ACCESS_TOKEN);
	});
});
