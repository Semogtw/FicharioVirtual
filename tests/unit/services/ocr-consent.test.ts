import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabase = vi.hoisted(() => ({
	getSupabaseClient: vi.fn(() => {
		throw new Error('backend client constructed');
	})
}));

vi.mock('../../../src/lib/services/supabase', () => ({
	getSupabaseClient: supabase.getSupabaseClient
}));

import { OcrConsentError, recordOcrConsent } from '../../../src/lib/services/ocr-consent';

function client(result: unknown | (() => Promise<unknown>)) {
	const implementation =
		typeof result === 'function' ? (result as () => Promise<unknown>) : async () => result;
	return { rpc: vi.fn(implementation) };
}

beforeEach(() => {
	supabase.getSupabaseClient.mockClear();
});

describe('recordOcrConsent', () => {
	it.each([0, 1001, 1.5, Number.NaN])(
		'rejects invalid version %s before constructing the backend client',
		async (version) => {
			await expect(recordOcrConsent(version)).rejects.toThrow('Invalid OCR consent version');
			expect(supabase.getSupabaseClient).not.toHaveBeenCalled();
		}
	);

	it('sends the exact validated consent version', async () => {
		const gateway = client({ data: true, error: null });

		await expect(recordOcrConsent(7, gateway as never)).resolves.toBeUndefined();

		expect(gateway.rpc).toHaveBeenCalledWith('record_ocr_consent', { consent_version: 7 });
	});

	it.each([
		{ data: false, error: null },
		{ data: null, error: null },
		{ data: true, error: { message: 'database detail' } }
	])('maps rejected persistence response %# to a safe domain error', async (result) => {
		await expect(recordOcrConsent(1, client(result) as never)).rejects.toBeInstanceOf(
			OcrConsentError
		);
	});

	it('maps a thrown transport failure to the same safe domain error', async () => {
		const gateway = client(async () => {
			throw new Error('private transport detail');
		});

		await expect(recordOcrConsent(1, gateway as never)).rejects.toEqual(
			expect.objectContaining({
				name: 'OcrConsentError',
				message: 'Não foi possível registrar o consentimento de leitura automática.'
			})
		);
	});
});
