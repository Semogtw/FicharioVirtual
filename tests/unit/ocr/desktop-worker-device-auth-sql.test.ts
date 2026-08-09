import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	'supabase/migrations/202608081027_desktop_ocr_device_auth_boundary.sql',
	'utf8'
);

function body(name: string) {
	return (
		new RegExp(
			`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
			'i'
		).exec(source)?.[1] ?? ''
	);
}

describe('desktop worker device authentication boundary', () => {
	it('registers only a validated SHA-256 digest through a service-only RPC', () => {
		const sql = body('register_ocr_worker_device');
		expect(sql).toContain("digest_hex !~ '^[0-9a-f]{64}$'");
		expect(sql).toContain("decode(digest_hex, 'hex')");
		expect(source).toContain('revoke execute on function public.register_ocr_worker_device');
		expect(source).toContain('grant execute on function public.register_ocr_worker_device');
	});

	it('authenticates only an active device by digest without returning the digest', () => {
		const sql = body('authenticate_ocr_worker_device');
		expect(sql).toContain("decode(digest_hex, 'hex')");
		expect(sql).toContain("device.status = 'active'");
		expect(sql).not.toContain('credential_hash,');
		expect(sql).toContain('device.user_id');
	});

	it('revokes only an owned device and requeues its leased desktop jobs atomically', () => {
		const sql = body('revoke_ocr_worker_device');
		expect(sql).toContain('auth.uid()');
		expect(sql).toContain('for update');
		expect(sql).toContain("status = 'revoked'");
		expect(sql).toContain("status = 'waiting_desktop'::public.ocr_status");
		expect(sql).toContain('desktop_lease_device_id = null');
		expect(sql).toContain('desktop_lease_id = null');
	});

	it('resolves source metadata only for an exact active unexpired lease tuple', () => {
		const sql = body('get_desktop_ocr_job_source');
		expect(sql).toContain('job.desktop_lease_device_id = target_device_id');
		expect(sql).toContain('job.desktop_lease_id = target_lease_id');
		expect(sql).toContain("job.desktop_lease_expires_at > timezone('utc', now())");
		expect(sql).toContain("job.route = 'desktop'::public.ocr_route");
		expect(sql).toContain("job.status = 'processing'::public.ocr_status");
		expect(sql).toContain("device.status = 'active'");
		expect(sql).toContain('page.storage_path');
		expect(sql).not.toContain('refresh_token');
	});

	it('keeps service-only functions away from browser roles', () => {
		for (const signature of [
			'register_ocr_worker_device(uuid, text, text, jsonb)',
			'authenticate_ocr_worker_device(text)',
			'get_desktop_ocr_job_source(uuid, uuid, uuid)'
		]) {
			expect(source).toContain(`revoke execute on function public.${signature} from public`);
			expect(source).toContain(`revoke execute on function public.${signature} from anon`);
			expect(source).toContain(`revoke execute on function public.${signature} from authenticated`);
			expect(source).toContain(`grant execute on function public.${signature} to service_role`);
		}
	});

	it('hardens every security-definer function', () => {
		expect(source.match(/security definer/g)?.length).toBe(4);
		expect(source.match(/set search_path = ''/g)?.length).toBe(4);
	});
});
