import { beforeEach, describe, expect, it, vi } from 'vitest';

const modules = vi.hoisted(() => ({
	getSupabaseClient: vi.fn(() => {
		throw new Error('backend client constructed');
	}),
	calculateSha256: vi.fn(async () => 'a'.repeat(64))
}));

vi.mock('../../../src/lib/services/supabase', () => ({
	getSupabaseClient: modules.getSupabaseClient
}));

vi.mock('../../../src/lib/import/hash', () => ({
	calculateSha256: modules.calculateSha256
}));

import { ImageUploadError, uploadPreparedImage } from '../../../src/lib/import/upload';
import type { PreparedImage } from '../../../src/lib/import/image-types';

const userId = '11111111-1111-4111-8111-111111111111';

function prepared(): PreparedImage {
	return {
		image: new Blob(['image'], { type: 'image/webp' }),
		thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
		width: 1200,
		height: 900,
		format: 'image/webp',
		originalName: 'scan.png',
		originalBytes: 100,
		preparedBytes: 10
	};
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function clientFixture() {
	const getSession = vi.fn(async () => ({
		data: { session: { user: { id: userId } } },
		error: null
	}));
	const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
	const eq = vi.fn(() => ({ maybeSingle }));
	const select = vi.fn(() => ({ eq }));
	const from = vi.fn(() => ({ select }));
	const upload = vi.fn(async (_path: string, _blob: Blob, _options: unknown) => ({ error: null }));
	const remove = vi.fn(async (_paths: string[]) => ({ error: null }));
	const storageFrom = vi.fn(() => ({ upload, remove }));
	const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
		data: [
			{
				document_id: args.target_document_id,
				page_id: args.target_page_id,
				ocr_job_id: args.target_job_id
			}
		],
		error: null
	}));
	const client = {
		auth: { getSession },
		from,
		storage: { from: storageFrom },
		rpc
	};
	return { client, getSession, maybeSingle, upload, remove, rpc };
}

beforeEach(() => {
	modules.getSupabaseClient.mockClear();
	modules.calculateSha256.mockClear();
});

describe('uploadPreparedImage failure safety', () => {
	it('validates prompt version before constructing the backend client', async () => {
		await expect(uploadPreparedImage({ prepared: prepared(), promptVersion: 0 })).rejects.toThrow(
			'Invalid OCR prompt version'
		);
		expect(modules.getSupabaseClient).not.toHaveBeenCalled();
	});

	it('maps a thrown session lookup to the safe authentication error', async () => {
		const fixture = clientFixture();
		fixture.getSession.mockRejectedValueOnce(new Error('private auth transport detail'));

		await expect(
			uploadPreparedImage({ prepared: prepared() }, fixture.client as never)
		).rejects.toEqual(
			expect.objectContaining({
				name: 'ImageUploadError',
				code: 'not_authenticated'
			})
		);
	});

	it('cleans both candidate paths when one parallel upload throws', async () => {
		const fixture = clientFixture();
		fixture.upload.mockImplementation(async (path: string) => {
			if (path.includes('/thumbnail.')) throw new Error('private storage detail');
			return { error: null };
		});

		await expect(
			uploadPreparedImage({ prepared: prepared() }, fixture.client as never)
		).rejects.toEqual(expect.objectContaining({ code: 'upload_failed' }));
		expect(fixture.remove).toHaveBeenCalledOnce();
		expect(fixture.remove.mock.calls[0]?.[0]).toEqual([
			expect.stringMatching(/\/original\.webp$/),
			expect.stringMatching(/\/thumbnail\.jpg$/)
		]);
	});

	it('cleans uploaded objects when metadata RPC throws', async () => {
		const fixture = clientFixture();
		fixture.rpc.mockRejectedValueOnce(new Error('private rpc transport detail'));

		await expect(
			uploadPreparedImage({ prepared: prepared() }, fixture.client as never)
		).rejects.toEqual(expect.objectContaining({ code: 'metadata_failed' }));
		expect(fixture.remove).toHaveBeenCalledOnce();
	});

	it('does not begin storage uploads after cancellation during duplicate lookup', async () => {
		const fixture = clientFixture();
		const duplicate = deferred<{ data: null; error: null }>();
		fixture.maybeSingle.mockReturnValueOnce(duplicate.promise);
		const controller = new AbortController();

		const pending = uploadPreparedImage(
			{ prepared: prepared(), signal: controller.signal },
			fixture.client as never
		);
		await vi.waitFor(() => expect(fixture.maybeSingle).toHaveBeenCalledOnce());
		controller.abort();
		duplicate.resolve({ data: null, error: null });

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(fixture.upload).not.toHaveBeenCalled();
	});
});
