import { describe, expect, it } from 'vitest';
import {
	InvalidJsonBodyError,
	RequestBodyTooLargeError,
	readBoundedJson
} from '../../../supabase/functions/_shared/bounded-json';

function chunkedRequest(chunks: readonly string[]) {
	const encoder = new TextEncoder();
	let index = 0;
	return new Request('https://example.invalid/', {
		method: 'POST',
		body: new ReadableStream<Uint8Array>({
			pull(controller) {
				const chunk = chunks[index++];
				if (chunk === undefined) controller.close();
				else controller.enqueue(encoder.encode(chunk));
			}
		}),
		duplex: 'half'
	} as RequestInit & { duplex: 'half' });
}

describe('readBoundedJson', () => {
	it('parses a bounded JSON body', async () => {
		const request = new Request('https://example.invalid/', {
			method: 'POST',
			body: JSON.stringify({ action: 'claim' })
		});
		await expect(readBoundedJson(request, 1024)).resolves.toEqual({ action: 'claim' });
	});

	it('rejects a declared body that exceeds the limit before reading it', async () => {
		const request = new Request('https://example.invalid/', {
			method: 'POST',
			headers: { 'Content-Length': '4097' },
			body: '{}'
		});
		await expect(readBoundedJson(request, 4096)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
	});

	it('rejects a chunked body as soon as cumulative bytes exceed the limit', async () => {
		const request = chunkedRequest(['{"value":"', 'x'.repeat(32), '"}']);
		await expect(readBoundedJson(request, 16)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
	});

	it('rejects malformed and empty JSON bodies', async () => {
		await expect(readBoundedJson(chunkedRequest(['{']), 64)).rejects.toBeInstanceOf(
			InvalidJsonBodyError
		);
		await expect(readBoundedJson(chunkedRequest([]), 64)).rejects.toBeInstanceOf(
			InvalidJsonBodyError
		);
	});
});
