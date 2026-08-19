import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SOURCE_PATH = 'supabase/functions/desktop-ocr-pair/index.ts';

describe('desktop OCR pairing boundary', () => {
	it('is a redeem-only public gateway backed by the service-only one-time-code RPC', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');
		expect(source).toContain("record.action !== 'redeem'");
		expect(source).toContain("admin.rpc('redeem_ocr_worker_pairing_code'");
		expect(source).toContain('credentialDigest: string');
		expect(source).toContain('SHA256_HEX.test(record.credentialDigest)');
		expect(source).not.toContain("request.headers.get('Authorization')");
		expect(source).not.toContain("if (input.action === 'revoke')");
		expect(source).not.toContain('register_ocr_worker_device');
	});

	it('requires the exact code-redemption request shape', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');
		for (const field of ['action', 'pairingCode', 'label', 'capabilities', 'credentialDigest']) {
			expect(source).toContain(`'${field}'`);
		}
		expect(source).toContain('PAIRING_CODE.test(record.pairingCode)');
		expect(source).toContain('SHA256_HEX.test(record.credentialDigest)');
	});
});
