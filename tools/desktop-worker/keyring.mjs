import { spawn } from 'node:child_process';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_SECRET_TOOL = '/usr/bin/secret-tool';
const MAX_STDOUT_BYTES = 1024;
const TOOL_TIMEOUT_MS = 15_000;

function requireDeviceId(value) {
	if (typeof value !== 'string' || !UUID.test(value)) {
		throw new TypeError('Invalid desktop worker device id');
	}
	return value;
}

function requireCredential(value) {
	if (typeof value !== 'string' || !CREDENTIAL.test(value)) {
		throw new TypeError('Invalid desktop worker credential');
	}
	return value;
}

function safeCommand(value) {
	if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0')) {
		throw new TypeError('Invalid Secret Service command path');
	}
	return value;
}

export class SecretServiceError extends Error {
	constructor(code) {
		super(`Desktop worker Secret Service operation failed (${code})`);
		this.name = 'SecretServiceError';
		this.code = code;
	}
}

export function runSecretTool(
	args,
	{ input = null, command = DEFAULT_SECRET_TOOL, spawnImpl = spawn, signal } = {}
) {
	if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
		throw new TypeError('Invalid Secret Service arguments');
	}
	if (input !== null && typeof input !== 'string') {
		throw new TypeError('Invalid Secret Service input');
	}
	if (typeof spawnImpl !== 'function') throw new TypeError('Invalid Secret Service process runner');
	const executable = safeCommand(command);
	const timeout = AbortSignal.timeout(TOOL_TIMEOUT_MS);
	const processSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawnImpl(executable, args, {
				stdio: ['pipe', 'pipe', 'ignore'],
				shell: false,
				windowsHide: true,
				signal: processSignal
			});
		} catch (error) {
			if (error?.name === 'AbortError') {
				reject(error);
				return;
			}
			reject(new SecretServiceError('secret_service_unavailable'));
			return;
		}

		const chunks = [];
		let stdoutBytes = 0;
		let settled = false;
		const finish = (callback) => {
			if (settled) return;
			settled = true;
			callback();
		};

		child.stdout.on('data', (chunk) => {
			const bytes = Buffer.from(chunk);
			stdoutBytes += bytes.byteLength;
			if (stdoutBytes > MAX_STDOUT_BYTES) {
				child.kill('SIGKILL');
				finish(() => reject(new SecretServiceError('secret_service_response_too_large')));
				return;
			}
			chunks.push(bytes);
		});
		child.on('error', (error) => {
			if (error?.name === 'AbortError') {
				finish(() => reject(error));
				return;
			}
			finish(() => reject(new SecretServiceError('secret_service_unavailable')));
		});
		child.on('close', (code, signalName) => {
			if (settled) return;
			if (processSignal.aborted) {
				finish(() =>
					reject(
						processSignal.reason instanceof Error
							? processSignal.reason
							: new DOMException('Aborted', 'AbortError')
					)
				);
				return;
			}
			if (code !== 0 || signalName) {
				finish(() => reject(new SecretServiceError('secret_service_rejected')));
				return;
			}
			finish(() => resolve(Buffer.concat(chunks).toString('utf8')));
		});

		if (input === null) child.stdin.end();
		else child.stdin.end(input, 'utf8');
	});
}

export class SecretServiceCredentialStore {
	#run;
	#command;

	constructor({ runTool = runSecretTool, command = DEFAULT_SECRET_TOOL } = {}) {
		if (typeof runTool !== 'function') throw new TypeError('Invalid Secret Service adapter');
		this.#run = runTool;
		this.#command = safeCommand(command);
	}

	async store(deviceId, credential, { signal } = {}) {
		const id = requireDeviceId(deviceId);
		const secret = requireCredential(credential);
		await this.#run(
			['store', '--label=Fichario OCR Worker', 'application', 'fichario-worker', 'device-id', id],
			{ input: secret, command: this.#command, signal }
		);
		return true;
	}

	async load(deviceId, { signal } = {}) {
		const id = requireDeviceId(deviceId);
		let output;
		try {
			output = await this.#run(['lookup', 'application', 'fichario-worker', 'device-id', id], {
				command: this.#command,
				signal
			});
		} catch (error) {
			if (error instanceof SecretServiceError && error.code === 'secret_service_rejected') {
				return null;
			}
			throw error;
		}
		const value = output.endsWith('\n') ? output.slice(0, -1) : output;
		if (!CREDENTIAL.test(value)) {
			throw new SecretServiceError('secret_service_credential_invalid');
		}
		return value;
	}

	async clear(deviceId, { signal } = {}) {
		const id = requireDeviceId(deviceId);
		try {
			await this.#run(['clear', 'application', 'fichario-worker', 'device-id', id], {
				command: this.#command,
				signal
			});
			return true;
		} catch (error) {
			if (error instanceof SecretServiceError && error.code === 'secret_service_rejected') {
				return false;
			}
			throw error;
		}
	}
}
