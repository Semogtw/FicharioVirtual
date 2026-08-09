import { describe, expect, it } from 'vitest';
import {
	InvalidResponseBodyError,
	ResponseBodyTooLargeError,
	readBoundedResponseJson,
	readBoundedResponseText
} from '../../../supabase/functions/_shared/bounded-response';

function chunkedResponse(chunks: readonly string[], headers: Record<string, string> = {}) {
	const encoder = new TextEncoder();
	let index = 0;
	return new Response(
		new ReadableStream<Uint8Array>({
			pull(controller) {
				const chunk = chunks[index++];
				if (chunk === undefined) controller.close();
				else controller.enqueue(encoder.encode(chunk));
			}
		}),
		{ status: 200, headers }
	);
}

describe('bounded provider response reader', () => {
	it('parses JSON inside the configured byte ceiling', async () => {
		await expect(readBoundedResponseJson(chunkedResponse(['{"ok":true}']), 64)).resolves.toEqual({
			ok: true
		});
	});

	it('rejects oversized declared responses before consuming the body', async () => {
		const response = chunkedResponse(['{}'], { 'Content-Length': '65' });
		await expect(readBoundedResponseText(response, 64)).rejects.toBeInstanceOf(
			ResponseBodyTooLargeError
		);
	});

	it('rejects chunked responses once cumulative bytes exceed the ceiling', async () => {
		await expect(readBoundedResponseText(chunkedResponse(['abcd', 'efgh']), 7)).rejects.toBeInstanceOf(
			ResponseBodyTooLargeError
		);
	});

	it('rejects malformed JSON and invalid UTF-8', async () => {
		await expect(readBoundedResponseJson(chunkedResponse(['{']), 64)).rejects.toBeInstanceOf(
			InvalidResponseBodyError
		);
		await expect(
			readBoundedResponseText(
				new Response(new Uint8Array([0xc3, 0x28]), { status: 200 }),
				64
			)
		).rejects.toBeInstanceOf(InvalidResponseBodyError);
	});
});
