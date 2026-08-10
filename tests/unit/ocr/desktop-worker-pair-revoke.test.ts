import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SOURCE_PATH = 'supabase/functions/desktop-ocr-pair/index.ts';

describe('desktop OCR pairing and rollback boundary', () => {
	it('revokes through the authenticated user client rather than service role', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');
		expect(source).toContain("if (input.action === 'revoke')");
		expect(source).toContain("userClient.rpc('revoke_ocr_worker_device'");
		expect(source).not.toContain("admin.rpc('revoke_ocr_worker_device'");
	});

	it('redeems a one-time code through the service-only RPC before browser authentication', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');
		const redeemBranch = source.indexOf("if (input.action === 'redeem')");
		const authorizationLookup = source.indexOf("request.headers.get('Authorization')");
		expect(redeemBranch).toBeGreaterThanOrEqual(0);
		expect(redeemBranch).toBeLessThan(authorizationLookup);
		expect(source).toContain("admin.rpc('redeem_ocr_worker_pairing_code'");
		expect(source).toContain('credentialDigest: string');
		expect(source).not.toContain('credential: input.credential');
	});

	it('keeps authenticated revoke ahead of the legacy service-role registration branch', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');
		const revokeBranch = source.indexOf("if (input.action === 'revoke')");
		const legacyRegistration = source.indexOf("admin.rpc('register_ocr_worker_device'");
		expect(revokeBranch).toBeGreaterThanOrEqual(0);
		expect(legacyRegistration).toBeGreaterThan(revokeBranch);
	});

	it('requires exact request shapes for revoke and code redemption', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');
		expect(source).toContain("hasExactKeys(record, ['action', 'deviceId'])");
		expect(source).toContain("record.action === 'revoke'");
		expect(source).toContain('UUID.test(record.deviceId)');
		expect(source).toContain(
			"hasExactKeys(record, ['action', 'pairingCode', 'label', 'capabilities', 'credentialDigest'])"
		);
		expect(source).toContain("record.action !== 'redeem'");
		expect(source).toContain('PAIRING_CODE.test(record.pairingCode)');
		expect(source).toContain('SHA256_HEX.test(record.credentialDigest)');
	});
});
