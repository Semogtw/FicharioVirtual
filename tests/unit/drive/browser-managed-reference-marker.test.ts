import { describe, expect, it, vi } from 'vitest';
import { clearBrowserDrivePdfReferenceMarker } from '../../../src/lib/drive/browser-files';

const accessToken = 'ephemeral-access-token-value';
const expiresAt = '2026-08-07T23:00:00.000Z';
const fileId = '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

function client() {
	return {
		functions: {
			invoke: vi.fn().mockResolvedValue({ data: { accessToken, expiresAt }, error: null })
		}
	} as never;
}

describe('managed Drive PDF reference marker cleanup', () => {
	it('clears only the private oversized-reference marker fields after durable staging', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: fileId, appProperties: {} }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);

		await expect(
			clearBrowserDrivePdfReferenceMarker({ client: client(), fileId, fetchImpl })
		).resolves.toBeUndefined();

		const [rawUrl, init] = fetchImpl.mock.calls[0] ?? [];
		const url = new URL(rawUrl as string);
		expect(url.pathname).toBe(`/drive/v3/files/${fileId}`);
		expect(url.searchParams.get('fields')).toBe('id,appProperties');
		expect(init).toMatchObject({
			method: 'PATCH',
			redirect: 'error',
			cache: 'no-store'
		});
		expect(JSON.parse(init.body as string)).toEqual({
			appProperties: {
				ficharioPurpose: null,
				ficharioDocumentId: null
			}
		});
	});

	it('accepts an omitted empty appProperties object in the Drive response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: fileId }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		await expect(
			clearBrowserDrivePdfReferenceMarker({ client: client(), fileId, fetchImpl })
		).resolves.toBeUndefined();
	});

	it('fails closed if Drive reports that either managed marker is still present', async () => {
		for (const appProperties of [
			{ ficharioPurpose: 'oversized_pdf_reference' },
			{ ficharioDocumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
		]) {
			const fetchImpl = vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ id: fileId, appProperties }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);
			await expect(
				clearBrowserDrivePdfReferenceMarker({ client: client(), fileId, fetchImpl })
			).rejects.toThrow('Não foi possível limpar o marcador da cópia gerenciada no Google Drive.');
		}
	});

	it('rejects an unexpected response file id', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: '3AbCdEfGhIjKlMnOpQrStUvWxYz_123456' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		await expect(
			clearBrowserDrivePdfReferenceMarker({ client: client(), fileId, fetchImpl })
		).rejects.toThrow('Não foi possível limpar o marcador da cópia gerenciada no Google Drive.');
	});
});
