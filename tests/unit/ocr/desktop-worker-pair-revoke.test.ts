import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SOURCE_PATH = 'supabase/functions/desktop-ocr-pair/index.ts';

describe('desktop OCR pairing rollback boundary', () => {
	it('revokes through the authenticated user client rather than service role', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');
		expect(source).toContain("if (input.action === 'revoke')");
		expect(source).toContain("userClient.rpc('revoke_ocr_worker_device'");
		expect(source).not.toContain("admin.rpc('revoke_ocr_worker_device'");
	});

	it('handles revocation before requiring the service-role key used only for registration', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');
		const revokeBranch = source.indexOf("if (input.action === 'revoke')");
		const serviceRoleLookup = source.indexOf("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
		expect(revokeBranch).toBeGreaterThanOrEqual(0);
		expect(serviceRoleLookup).toBeGreaterThan(revokeBranch);
	});

	it('requires an exact revoke request shape with a UUID device id', async () => {
		const source = await readFile(SOURCE_PATH, 'utf8');
		expect(source).toContain("hasExactKeys(record, ['action', 'deviceId'])");
		expect(source).toContain("record.action === 'revoke'");
		expect(source).toContain('UUID.test(record.deviceId)');
	});
});
