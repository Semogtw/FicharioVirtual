import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_MIME_TYPES = new Set(['image/webp', 'image/jpeg']);
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

function validSource(source) {
	return (
		source &&
		typeof source === 'object' &&
		!Array.isArray(source) &&
		typeof source.jobId === 'string' &&
		UUID.test(source.jobId) &&
		typeof source.sourceUrl === 'string' &&
		source.sourceUrl.length <= 4096 &&
		typeof source.sourceSha256 === 'string' &&
		SHA256.test(source.sourceSha256) &&
		typeof source.mimeType === 'string' &&
		SOURCE_MIME_TYPES.has(source.mimeType) &&
		Number.isSafeInteger(source.sourceBytes) &&
		source.sourceBytes >= 1 &&
		source.sourceBytes <= MAX_SOURCE_BYTES
	);
}

function parseSourceUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
	return url.toString();
}

function parseContentLength(value) {
	if (value === null) return null;
	if (!/^[0-9]+$/.test(value)) return Number.NaN;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function sourceExtension(mimeType) {
	return mimeType === 'image/webp' ? '.webp' : '.jpg';
}

export class DesktopSourceError extends Error {
	constructor(code, cause) {
		super(`Desktop worker source download failed (${code})`, cause ? { cause } : undefined);
		this.name = 'DesktopSourceError';
		this.code = code;
	}
}

export async function downloadDesktopSource(
	source,
	{ downloadsDir, fetchImpl = fetch, signal } = {}
) {
	if (!validSource(source)) throw new TypeError('Invalid desktop worker source descriptor');
	if (typeof downloadsDir !== 'string' || downloadsDir.length === 0) {
		throw new TypeError('Invalid desktop worker downloads directory');
	}
	if (typeof fetchImpl !== 'function') throw new TypeError('Invalid desktop worker fetch implementation');
	const sourceUrl = parseSourceUrl(source.sourceUrl);
	if (!sourceUrl) throw new TypeError('Invalid desktop worker source URL');

	await mkdir(downloadsDir, { recursive: true, mode: 0o700 });
	await chmod(downloadsDir, 0o700);

	const token = randomUUID();
	const temporaryPath = join(downloadsDir, `.${source.jobId}.${token}.part`);
	const finalPath = join(downloadsDir, `${source.jobId}.${token}${sourceExtension(source.mimeType)}`);
	let handle;
	let promoted = false;
	try {
		let response;
		try {
			response = await fetchImpl(sourceUrl, {
				method: 'GET',
				headers: { Accept: source.mimeType },
				redirect: 'error',
				signal
			});
		} catch (error) {
			if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
			throw new DesktopSourceError('source_network_failed', error);
		}

		if (response.status !== 200) throw new DesktopSourceError('source_http_failed');
		if (response.headers.get('content-type') !== source.mimeType) {
			throw new DesktopSourceError('source_type_mismatch');
		}
		const contentLength = parseContentLength(response.headers.get('content-length'));
		if (!Number.isFinite(contentLength) && contentLength !== null) {
			throw new DesktopSourceError('source_length_invalid');
		}
		if (contentLength !== null && contentLength !== source.sourceBytes) {
			throw new DesktopSourceError('source_length_mismatch');
		}
		if (!response.body) throw new DesktopSourceError('source_body_missing');

		handle = await open(temporaryPath, 'wx', 0o600);
		const hash = createHash('sha256');
		let received = 0;
		for await (const chunk of response.body) {
			const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
			received += bytes.byteLength;
			if (received > source.sourceBytes || received > MAX_SOURCE_BYTES) {
				throw new DesktopSourceError('source_too_large');
			}
			hash.update(bytes);
			await handle.write(bytes);
		}
		if (received !== source.sourceBytes) throw new DesktopSourceError('source_length_mismatch');
		if (hash.digest('hex') !== source.sourceSha256) {
			throw new DesktopSourceError('source_hash_mismatch');
		}

		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporaryPath, finalPath);
		promoted = true;
		return Object.freeze({
			jobId: source.jobId,
			path: finalPath,
			bytes: received,
			sha256: source.sourceSha256,
			mimeType: source.mimeType
		});
	} catch (error) {
		if (handle) await handle.close().catch(() => undefined);
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		if (promoted) await rm(finalPath, { force: true }).catch(() => undefined);
		throw error;
	}
}
