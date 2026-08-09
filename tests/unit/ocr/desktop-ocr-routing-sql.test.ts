import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPaths = [
	'supabase/migrations/202608081022_desktop_ocr_status_enum.sql',
	'supabase/migrations/202608081023_desktop_ocr_devices_and_route.sql',
	'supabase/migrations/202608081024_desktop_ocr_job_leases.sql',
	'supabase/migrations/202608081025_guard_gemini_completion_route.sql'
];

const sources = migrationPaths.map((path) => readFileSync(path, 'utf8'));
const [statusEnumSource, deviceRouteSource, leaseSource, completionGuardSource] = sources;
const source = sources.join('\n');

function functionBody(name: string, sql: string) {
	const expression = new RegExp(
		`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`,
		'i'
	);
	return expression.exec(sql)?.[1] ?? '';
}

describe('desktop OCR routing and lease migrations', () => {
	it('adds waiting_desktop in an isolated enum migration before route consumers', () => {
		expect(statusEnumSource).toContain(
		"alter type public.ocr_status add value if not exists 'waiting_desktop'"
	);
		expect(statusEnumSource).not.toContain('ocr_jobs');
		expect(deviceRouteSource).toContain("create type public.ocr_route as enum ('gemini', 'desktop')");
		expect(deviceRouteSource).toContain(
		"add column route public.ocr_route not null default 'gemini'"
	);
	});

	it('keeps worker credential digests inside a service-private device table', () => {
		expect(deviceRouteSource).toContain('create table public.ocr_worker_devices');
		expect(deviceRouteSource).toContain('credential_hash bytea not null unique');
		expect(deviceRouteSource).toContain('octet_length(credential_hash) = 32');
		expect(deviceRouteSource).toContain("status in ('active', 'revoked')");
		expect(deviceRouteSource).toContain("jsonb_typeof(capabilities) = 'object'");
		expect(deviceRouteSource).toContain('unique (id, user_id)');
		expect(deviceRouteSource).toContain('enable row level security');
		expect(deviceRouteSource).toContain(
		'revoke all on table public.ocr_worker_devices from public, anon, authenticated'
	);
		expect(deviceRouteSource).not.toContain(
		'grant select on public.ocr_worker_devices to authenticated'
	);
	});

	it('exposes only safe device metadata through the authenticated list RPC', () => {
		const body = functionBody('list_ocr_worker_devices', deviceRouteSource);
		expect(body).not.toBe('');
		expect(body).toContain('device.id');
		expect(body).toContain('device.label');
		expect(body).toContain('device.status');
		expect(body).toContain('device.capabilities');
		expect(body).toContain('device.last_seen_at');
		expect(body).not.toContain('credential_hash');
		expect(deviceRouteSource).toContain(
		'revoke execute on function public.list_ocr_worker_devices() from public'
	);
		expect(deviceRouteSource).toContain(
		'grant execute on function public.list_ocr_worker_devices() to authenticated'
	);
	});

	it('binds desktop lease ownership to a same-user active device', () => {
		expect(leaseSource).toContain('desktop_lease_device_id uuid');
		expect(leaseSource).toContain('desktop_lease_id uuid');
		expect(leaseSource).toContain('desktop_lease_expires_at timestamptz');
		expect(leaseSource).toContain('desktop_lease_started_at timestamptz');
		expect(leaseSource).toContain('foreign key (desktop_lease_device_id, user_id)');
		expect(leaseSource).toContain('references public.ocr_worker_devices(id, user_id)');
		expect(leaseSource).toContain('desktop_ocr_lease_shape');
	});

	it('claims deterministic waiting jobs with SKIP LOCKED and an exact lease id', () => {
		const body = functionBody('claim_desktop_ocr_job', leaseSource);
		expect(body).not.toBe('');
		expect(body.toLowerCase()).toContain('for update skip locked');
		expect(body.toLowerCase()).toContain('order by job.created_at, job.id');
		expect(body).toContain("job.route = 'desktop'::public.ocr_route");
		expect(body).toContain("job.status = 'waiting_desktop'::public.ocr_status");
		expect(body).toContain('target_lease_id');
		expect(body).toContain("device.status = 'active'");
	});

	it('renews only an unexpired exact device/job/lease tuple and can expire stale work', () => {
		const renew = functionBody('renew_desktop_ocr_job_lease', leaseSource);
		const expire = functionBody('expire_desktop_ocr_job_leases', leaseSource);
		expect(renew).toContain('desktop_lease_device_id = target_device_id');
		expect(renew).toContain('desktop_lease_id = target_lease_id');
		expect(renew).toContain("desktop_lease_expires_at > timezone('utc', now())");
		expect(expire).toContain("status = 'waiting_desktop'::public.ocr_status");
		expect(expire).toContain("desktop_lease_expires_at <= timezone('utc', now())");
	});

	it('keeps lease mutation RPCs service-role only', () => {
		for (const signature of [
			'claim_desktop_ocr_job(uuid, uuid, uuid, integer)',
			'renew_desktop_ocr_job_lease(uuid, uuid, uuid, integer)',
			'expire_desktop_ocr_job_leases()'
		]) {
			expect(leaseSource).toContain(`revoke execute on function public.${signature} from public`);
			expect(leaseSource).toContain(`revoke execute on function public.${signature} from anon`);
			expect(leaseSource).toContain(
				`revoke execute on function public.${signature} from authenticated`
			);
			expect(leaseSource).toContain(
				`grant execute on function public.${signature} to service_role`
			);
		}
	});

	it('guards the existing Gemini completion entry point from desktop-routed jobs', () => {
		const body = functionBody('complete_ocr_job', completionGuardSource);
		expect(body).not.toBe('');
		expect(body).toContain("route is distinct from 'gemini'::public.ocr_route");
		expect(body).toContain('Desktop-routed OCR jobs require the desktop completion boundary');
		expect(completionGuardSource).toContain("set search_path = ''");
	});

	it('keeps every new security-definer surface explicitly hardened', () => {
		for (const sql of [deviceRouteSource, leaseSource, completionGuardSource]) {
			if (!sql.includes('security definer')) continue;
			expect(sql).toContain("set search_path = ''");
		}
		expect(source).not.toContain('service_role_key');
		expect(source).not.toContain('refresh_token');
	});
});
