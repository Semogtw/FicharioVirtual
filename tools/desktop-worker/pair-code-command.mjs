import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { buildWorkerCapabilities } from './capabilities.mjs';
import { loadWorkerConfig } from './config.mjs';
import { SecretServiceCredentialStore } from './keyring.mjs';
import { loadModelLock, modelLockPath } from './model-lock.mjs';
import { pairDesktopWorkerWithCode } from './pair-code.mjs';
import { ensureWorkerDirectories, resolveWorkerPaths } from './paths.mjs';

const PAIRING_CODE = /^[0-9A-Fa-f]{4}(-[0-9A-Fa-f]{4}){3}$/;
const MAX_PAIRING_CODE_BYTES = 32;
const SAFE_CODE = /^[a-z0-9_]{3,96}$/;

function safeErrorCode(error) {
	return typeof error?.code === 'string' && SAFE_CODE.test(error.code)
		? error.code
		: 'worker_pair_code_cli_failed';
}

function stripSingleLineEnding(value) {
	if (value.endsWith('\r\n')) return value.slice(0, -2);
	if (value.endsWith('\n')) return value.slice(0, -1);
	return value;
}

function normalizePairingCode(value) {
	const normalized = value.trim().toUpperCase();
	if (!PAIRING_CODE.test(normalized)) {
		throw new TypeError('Invalid desktop worker pairing code');
	}
	return normalized;
}

async function readPipedCode(input) {
	const chunks = [];
	let total = 0;
	for await (const chunk of input) {
		const bytes = Buffer.from(chunk);
		total += bytes.byteLength;
		if (total > MAX_PAIRING_CODE_BYTES) {
			throw new TypeError('Desktop worker pairing code is too large');
		}
		chunks.push(bytes);
	}
	const value = stripSingleLineEnding(Buffer.concat(chunks).toString('utf8'));
	if (value.includes('\n') || value.includes('\r')) {
		throw new TypeError('Desktop worker pairing code must be one line');
	}
	return normalizePairingCode(value);
}

export async function readPairingCode(input = process.stdin, output = process.stderr) {
	if (!input || typeof input[Symbol.asyncIterator] !== 'function') {
		throw new TypeError('Invalid desktop worker pairing code input');
	}
	if (!output || typeof output.write !== 'function') {
		throw new TypeError('Invalid desktop worker pairing code prompt output');
	}
	if (input.isTTY === true) {
		const prompt = createInterface({ input, output, terminal: true });
		try {
			return normalizePairingCode(await prompt.question('Pairing code: '));
		} finally {
			prompt.close();
		}
	}
	return readPipedCode(input);
}

export async function pairFromLocalStateWithCode(
	{
		workerEndpoint,
		label,
		pairingCode,
		paths = resolveWorkerPaths(),
		credentialStore = new SecretServiceCredentialStore()
	},
	{
		loadConfig = loadWorkerConfig,
		loadLock = loadModelLock,
		buildCapabilities = buildWorkerCapabilities,
		pair = pairDesktopWorkerWithCode
	} = {}
) {
	await ensureWorkerDirectories(paths);
	const [config, lock] = await Promise.all([
		loadConfig(paths.configPath),
		loadLock(modelLockPath(paths))
	]);
	const capabilities = buildCapabilities(config, lock);
	return pair({
		workerEndpoint,
		label,
		capabilities,
		pairingCode,
		devicePath: paths.devicePath,
		credentialStore
	});
}

export async function runPairCodeCli(
	argv = process.argv.slice(2),
	{
		input = process.stdin,
		stdout = process.stdout,
		stderr = process.stderr,
		readCode = readPairingCode,
		pairLocal = pairFromLocalStateWithCode
	} = {}
) {
	if (
		!Array.isArray(argv) ||
		argv.length !== 2 ||
		argv.some((value) => typeof value !== 'string')
	) {
		stderr.write('Usage: fichario-worker-pair-code <worker-endpoint> <device-label>\n');
		return 2;
	}
	try {
		const pairingCode = await readCode(input, stderr);
		const result = await pairLocal({
			workerEndpoint: argv[0],
			label: argv[1],
			pairingCode
		});
		stdout.write(`${JSON.stringify(result)}\n`);
		return 0;
	} catch (error) {
		if (error?.name === 'AbortError') return 130;
		stderr.write(`${JSON.stringify({ status: 'failed', code: safeErrorCode(error) })}\n`);
		return 1;
	}
}
