export class RequestBodyTooLargeError extends Error {
	constructor() {
		super('Request body exceeds the allowed size');
		this.name = 'RequestBodyTooLargeError';
	}
}

export class InvalidJsonBodyError extends Error {
	constructor() {
		super('Request body is not valid JSON');
		this.name = 'InvalidJsonBodyError';
	}
}

function declaredLength(request: Request): number | null {
	const raw = request.headers.get('Content-Length');
	if (raw === null) return null;
	if (!/^\d{1,12}$/.test(raw)) throw new InvalidJsonBodyError();
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0) throw new InvalidJsonBodyError();
	return value;
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
		throw new TypeError('Invalid JSON body size limit');
	}
	const contentLength = declaredLength(request);
	if (contentLength !== null && contentLength > maxBytes) throw new RequestBodyTooLargeError();
	if (!request.body) throw new InvalidJsonBodyError();

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array)) throw new InvalidJsonBodyError();
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel('request body too large').catch(() => undefined);
				throw new RequestBodyTooLargeError();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	if (total < 1) throw new InvalidJsonBodyError();
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		return JSON.parse(text) as unknown;
	} catch {
		throw new InvalidJsonBodyError();
	} finally {
		bytes.fill(0);
		for (const chunk of chunks) chunk.fill(0);
	}
}
