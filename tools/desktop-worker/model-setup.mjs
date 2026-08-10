import { saveModelLock, modelLockPath } from './model-lock.mjs';
import { ensureWorkerDirectories, resolveWorkerPaths } from './paths.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const MODEL = /^[A-Za-z0-9._:/-]+$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function requireModel(value) {
	if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !MODEL.test(value)) {
		throw new TypeError('Invalid Ollama model id');
	}
	return value;
}

function requireLoopbackUrl(value) {
	if (typeof value !== 'string' || value.length > 2048) {
		throw new TypeError('Invalid Ollama loopback URL');
	}
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError('Invalid Ollama loopback URL');
	}
	if (
		url.protocol !== 'http:' ||
		(url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/'
	) {
		throw new TypeError('Ollama model setup requires a loopback-only endpoint');
	}
	return url;
}

async function readBoundedJson(response) {
	if (
		response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
		'application/json'
	) {
		throw new ModelSetupError('ollama_response_type_invalid');
	}
	const declared = response.headers.get('content-length');
	if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
		throw new ModelSetupError('ollama_response_too_large');
	}
	if (!response.body) throw new ModelSetupError('ollama_response_invalid');
	const chunks = [];
	let total = 0;
	for await (const chunk of response.body) {
		const bytes = Buffer.from(chunk);
		total += bytes.byteLength;
		if (total > MAX_RESPONSE_BYTES) throw new ModelSetupError('ollama_response_too_large');
		chunks.push(bytes);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new ModelSetupError('ollama_response_invalid');
	}
}

async function requestJson(fetchImpl, url, init, signal) {
	let response;
	try {
		response = await fetchImpl(url, { ...init, redirect: 'error', signal });
	} catch (error) {
		if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
		throw new ModelSetupError('ollama_unavailable');
	}
	const body = await readBoundedJson(response);
	if (!response.ok) throw new ModelSetupError('ollama_request_failed');
	return body;
}

function findLocalModel(body, model) {
	if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.models)) {
		throw new ModelSetupError('ollama_models_invalid');
	}
	const candidate = body.models.find(
		(item) =>
			item &&
			typeof item === 'object' &&
			!Array.isArray(item) &&
			(item.name === model || item.model === model)
	);
	if (!candidate) throw new ModelSetupError('ollama_model_missing');
	if (typeof candidate.digest !== 'string' || !SHA256.test(candidate.digest)) {
		throw new ModelSetupError('ollama_model_digest_invalid');
	}
	if (
		(typeof candidate.remote_model === 'string' && candidate.remote_model.length > 0) ||
		(typeof candidate.remote_host === 'string' && candidate.remote_host.length > 0)
	) {
		throw new ModelSetupError('ollama_remote_model_forbidden');
	}
	return candidate.digest;
}

function requireVision(body) {
	if (
		!body ||
		typeof body !== 'object' ||
		Array.isArray(body) ||
		!Array.isArray(body.capabilities) ||
		!body.capabilities.includes('vision')
	) {
		throw new ModelSetupError('ollama_model_not_vision');
	}
}

export class ModelSetupError extends Error {
	constructor(code) {
		super(`Desktop worker model setup failed (${code})`);
		this.name = 'ModelSetupError';
		this.code = code;
	}
}

export async function discoverLocalOllamaModel(
	model,
	{ baseUrl = 'http://127.0.0.1:11434/', fetchImpl = fetch, signal } = {}
) {
	const modelId = requireModel(model);
	const root = requireLoopbackUrl(baseUrl);
	if (typeof fetchImpl !== 'function') throw new TypeError('Invalid Ollama fetch implementation');

	const tags = await requestJson(
		fetchImpl,
		new URL('/api/tags', root),
		{ method: 'GET', headers: { Accept: 'application/json' } },
		signal
	);
	const digest = findLocalModel(tags, modelId);
	const details = await requestJson(
		fetchImpl,
		new URL('/api/show', root),
		{
			method: 'POST',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: modelId, verbose: false })
		},
		signal
	);
	requireVision(details);

	return Object.freeze({
		schemaVersion: 1,
		backend: 'ollama',
		model: modelId,
		digest
	});
}

export async function lockLocalOllamaModel(
	model,
	{
		paths = resolveWorkerPaths(),
		baseUrl = 'http://127.0.0.1:11434/',
		fetchImpl = fetch,
		signal,
		discover = discoverLocalOllamaModel,
		saveLock = saveModelLock
	} = {}
) {
	await ensureWorkerDirectories(paths);
	const lock = await discover(model, { baseUrl, fetchImpl, signal });
	await saveLock(modelLockPath(paths), lock);
	return lock;
}
