export class ResponseBodyTooLargeError extends Error {
	constructor() {
		super('Response body exceeds the allowed size');
		this.name = 'ResponseBodyTooLargeError';
	}
}

export class InvalidResponseBodyError extends Error {
	constructor() {
		super('Response body is invalid');
		this.name = 'InvalidResponseBodyError';
	}
}

function declaredLength(response: Response): number | null {
	const raw = response.headers.get('Content-Length');
	if (raw === null) return null;
	if (!/^\d{1,12}$/.test(raw)) throw new InvalidResponseBodyError();
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0) throw new InvalidResponseBodyError();
	return value;
}

export async function readBoundedResponseText(
	response: Response,
	maxBytes: number
): Promise<string> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
		throw new TypeError('Invalid response body size limit');
	}
	const contentLength = declaredLength(response);
	if (contentLength !== null && contentLength > maxBytes) throw new ResponseBodyTooLargeError();
	if (!response.body) throw new InvalidResponseBodyError();

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array)) throw new InvalidResponseBodyError();
			total += value.byteLength;
			if (total > maxBytes) {
				value.fill(0);
				await reader.cancel('response body too large').catch(() => undefined);
				throw new ResponseBodyTooLargeError();
			}
			chunks.push(value);
		}
	} catch (error) {
		for (const chunk of chunks) chunk.fill(0);
		throw error;
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new InvalidResponseBodyError();
	} finally {
		bytes.fill(0);
		for (const chunk of chunks) chunk.fill(0);
	}
}

export async function readBoundedResponseJson(
	response: Response,
	maxBytes: number
): Promise<unknown> {
	const text = await readBoundedResponseText(response, maxBytes);
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new InvalidResponseBodyError();
	}
}
