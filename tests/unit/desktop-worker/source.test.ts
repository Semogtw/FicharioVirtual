import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DesktopSourceError,
	downloadDesktopSource
} from '../../../tools/desktop-worker/source.mjs';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_URL = 'https://example.supabase.co/storage/v1/object/sign/documents/page?token=signed';
const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
	const path = await mkdtemp(join(tmpdir(), 'fichario-worker-source-'));
	temporaryDirectories.push(path);
	return path;
}

function descriptor(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
	return {
		jobId: JOB_ID,
		sourceUrl: SOURCE_URL,
		sourceSha256: createHash('sha256').update(bytes).digest('hex'),
		mimeType: 'image/webp',
		sourceBytes: bytes.byteLength,
		...overrides
	};
}

function response(bytes: Uint8Array, headers: Record<string, string> = {}) {
	return new Response(bytes, {
		status: 200,
		headers: {
			'Content-Type': 'image/webp',
			'Content-Length': String(bytes.byteLength),
			...headers
		}
	});
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
	);
});

describe('downloadDesktopSource', () => {
	it('streams the exact source into a private verified file without following redirects', async () => {
		const bytes = new TextEncoder().encode('synthetic-webp-bytes');
		const downloadsDir = await temporaryDirectory();
		const fetchImpl = vi.fn(async () => response(bytes));

		const result = await downloadDesktopSource(descriptor(bytes), { downloadsDir, fetchImpl });

		expect(await readFile(result.path)).toEqual(Buffer.from(bytes));
		expect(result).toMatchObject({
			jobId: JOB_ID,
			bytes: bytes.byteLength,
			sha256: descriptor(bytes).sourceSha256,
			mimeType: 'image/webp'
		});
		expect((await stat(downloadsDir)).mode & 0o777).toBe(0o700);
		expect((await stat(result.path)).mode & 0o777).toBe(0o600);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe(SOURCE_URL);
		expect(init?.redirect).toBe('error');
		expect(new Headers(init?.headers).get('Accept')).toBe('image/webp');
	});

	it('rejects a mismatched declared content length before writing any file', async () => {
		const bytes = new TextEncoder().encode('source');
		const downloadsDir = await temporaryDirectory();
		const fetchImpl = vi.fn(async () =>
			response(bytes, { 'Content-Length': String(bytes.byteLength + 1) })
		);

		await expect(
			downloadDesktopSource(descriptor(bytes), { downloadsDir, fetchImpl })
		).rejects.toMatchObject({ code: 'source_length_mismatch' });
		expect(await readdir(downloadsDir)).toEqual([]);
	});

	it('deletes partial bytes when a streaming response exceeds the bound source size', async () => {
		const expected = new TextEncoder().encode('small');
		const oversized = new TextEncoder().encode('small-but-now-larger');
		const downloadsDir = await temporaryDirectory();
		const fetchImpl = vi.fn(
			async () =>
				new Response(oversized, {
					status: 200,
					headers: { 'Content-Type': 'image/webp' }
				})
		);

		await expect(
			downloadDesktopSource(descriptor(expected), { downloadsDir, fetchImpl })
		).rejects.toMatchObject({ code: 'source_too_large' });
		expect(await readdir(downloadsDir)).toEqual([]);
	});

	it('deletes the temporary file when the source hash does not match the server binding', async () => {
		const bytes = new TextEncoder().encode('bound-source');
		const downloadsDir = await temporaryDirectory();
		const fetchImpl = vi.fn(async () => response(bytes));

		await expect(
			downloadDesktopSource(descriptor(bytes, { sourceSha256: '0'.repeat(64) }), {
				downloadsDir,
				fetchImpl
			})
		).rejects.toMatchObject({ code: 'source_hash_mismatch' });
		expect(await readdir(downloadsDir)).toEqual([]);
	});

	it('rejects an unexpected MIME type without preserving response bytes', async () => {
		const bytes = new TextEncoder().encode('jpeg-instead');
		const downloadsDir = await temporaryDirectory();
		const fetchImpl = vi.fn(async () => response(bytes, { 'Content-Type': 'image/jpeg' }));
		const error = await downloadDesktopSource(descriptor(bytes), { downloadsDir, fetchImpl }).catch(
			(caught) => caught
		);

		expect(error).toBeInstanceOf(DesktopSourceError);
		expect(error.code).toBe('source_type_mismatch');
		expect(await readdir(downloadsDir)).toEqual([]);
	});

	it('fails closed on non-HTTPS signed URLs before making a request', async () => {
		const bytes = new TextEncoder().encode('source');
		const downloadsDir = await temporaryDirectory();
		const fetchImpl = vi.fn();

		await expect(
			downloadDesktopSource(descriptor(bytes, { sourceUrl: 'http://127.0.0.1/private' }), {
				downloadsDir,
				fetchImpl
			})
		).rejects.toThrow('source URL');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
