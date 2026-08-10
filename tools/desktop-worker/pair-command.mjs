import process from 'node:process';
import { buildWorkerCapabilities } from './capabilities.mjs';
import { loadWorkerConfig } from './config.mjs';
import { SecretServiceCredentialStore } from './keyring.mjs';
import { loadModelLock, modelLockPath } from './model-lock.mjs';
import { pairDesktopWorker } from './pairing.mjs';
import { ensureWorkerDirectories, resolveWorkerPaths } from './paths.mjs';

const MAX_ACCESS_TOKEN_BYTES = 16 * 1024;
const SAFE_CODE = /^[a-z0-9_]{3,96}$/;

function safeErrorCode(error) {
	return typeof error?.code === 'string' && SAFE_CODE.test(error.code)
		? error.code
		: 'worker_pair_cli_failed';
}

function stripSingleLineEnding(value) {
	if (value.endsWith('\r\n')) return value.slice(0, -2);
	if (value.endsWith('\n')) return value.slice(0, -1);
	return value;
}

async function readPipedToken(input) {
	const chunks = [];
	let total = 0;
	for await (const chunk of input) {
		const bytes = Buffer.from(chunk);
		total += bytes.byteLength;
		if (total > MAX_ACCESS_TOKEN_BYTES + 2) {
			throw new TypeError('Desktop worker browser access token is too large');
		}
		chunks.push(bytes);
	}
	const value = stripSingleLineEnding(Buffer.concat(chunks).toString('utf8'));
	if (value.includes('\n') || value.includes('\r')) {
		throw new TypeError('Desktop worker browser access token must be one line');
	}
	return value;
}

function readHiddenTtyToken(input, output) {
	return new Promise((resolve, reject) => {
		let value = '';
		let settled = false;
		const cleanup = () => {
			input.removeListener('data', onData);
			try {
				input.setRawMode(false);
			} catch {
				// Preserve the original result if the TTY is already gone.
			}
			input.pause();
		};
		const finish = (callback) => {
			if (settled) return;
			settled = true;
			cleanup();
			output.write('\n');
			callback();
		};
		const onData = (chunk) => {
			for (const character of String(chunk)) {
				if (character === '\u0003') {
					finish(() => reject(new DOMException('Pairing cancelled', 'AbortError')));
					return;
				}
				if (character === '\r' || character === '\n') {
					finish(() => resolve(value));
					return;
				}
				if (character === '\u007f' || character === '\b') {
					value = value.slice(0, -1);
					continue;
				}
				if (character < ' ' || character === '\u007f') continue;
				value += character;
				if (Buffer.byteLength(value, 'utf8') > MAX_ACCESS_TOKEN_BYTES) {
					finish(() =>
						reject(new TypeError('Desktop worker browser access token is too large'))
					);
					return;
				}
			}
		};

		output.write('Browser session access token: ');
		input.setEncoding('utf8');
		input.setRawMode(true);
		input.resume();
		input.on('data', onData);
	});
}

export async function readBrowserAccessToken(input = process.stdin, output = process.stderr) {
	if (!input || typeof input[Symbol.asyncIterator] !== 'function') {
		throw new TypeError('Invalid desktop worker token input');
	}
	if (!output || typeof output.write !== 'function') {
		throw new TypeError('Invalid desktop worker token prompt output');
	}
	if (input.isTTY === true && typeof input.setRawMode === 'function') {
		return readHiddenTtyToken(input, output);
	}
	return readPipedToken(input);
}

export async function pairFromLocalState(
	{
		workerEndpoint,
		label,
		accessToken,
		paths = resolveWorkerPaths(),
		credentialStore = new SecretServiceCredentialStore()
	},
	{
		loadConfig = loadWorkerConfig,
		loadLock = loadModelLock,
		buildCapabilities = buildWorkerCapabilities,
		pair = pairDesktopWorker
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
		accessToken,
		devicePath: paths.devicePath,
		credentialStore
	});
}

export async function runPairCli(
	argv = process.argv.slice(2),
	{
		input = process.stdin,
		stdout = process.stdout,
		stderr = process.stderr,
		readToken = readBrowserAccessToken,
		pairLocal = pairFromLocalState
	} = {}
) {
	if (!Array.isArray(argv) || argv.length !== 2 || argv.some((value) => typeof value !== 'string')) {
		stderr.write('Usage: fichario-worker-pair <worker-endpoint> <device-label>\n');
		return 2;
	}
	try {
		const accessToken = await readToken(input, stderr);
		const result = await pairLocal({
			workerEndpoint: argv[0],
			label: argv[1],
			accessToken
		});
		stdout.write(`${JSON.stringify(result)}\n`);
		return 0;
	} catch (error) {
		if (error?.name === 'AbortError') return 130;
		stderr.write(`${JSON.stringify({ status: 'failed', code: safeErrorCode(error) })}\n`);
		return 1;
	}
}
