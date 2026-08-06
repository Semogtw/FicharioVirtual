import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'supabase/functions/drive-run-jobs/index.ts';

describe('Drive job runner Edge Function boundary', () => {
	it('authenticates the Fichário user and claims leased jobs through service-only RPCs', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('auth.getUser()');
		expect(source).toContain("rpc('get_drive_refresh_token'");
		expect(source).toContain("rpc('claim_drive_sync_job_for_user'");
		expect(source).toContain('parseClaimedDriveJob');
		expect(source).toContain('executeDriveJob');
		expect(source).toContain('MAX_JOBS_PER_INVOCATION = 25');
	});

	it('uses strict Drive helpers and all three terminal job transitions', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('ensureDriveFolder');
		expect(source).toContain('getGoogleDriveItem');
		expect(source).toContain('updateGoogleDriveItem');
		expect(source).toContain('deleteGoogleDriveItem');
		expect(source).toContain("rpc('complete_drive_sync_job'");
		expect(source).toContain("rpc('retry_drive_sync_job'");
		expect(source).toContain("rpc('conflict_drive_sync_job'");
	});

	it('keeps every Drive mutation boundary under the Deno type-check gate', () => {
		const gate = readFileSync('tools/checks/check-edge-functions.sh', 'utf8');

		expect(gate).toContain('supabase/functions/_shared/google-drive-mutations.ts');
		expect(gate).toContain('supabase/functions/_shared/drive-job-runner.ts');
		expect(gate).toContain('supabase/functions/drive-run-jobs/index.ts');
	});

	it('never persists or logs Google credentials in the function source', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).not.toContain('console.log');
		expect(source).not.toContain('console.error');
		expect(source).not.toContain('localStorage');
		expect(source).not.toContain('refreshToken:');
		expect(source).not.toContain('accessToken: refreshed.accessToken');
		expect(source).toContain("'Cache-Control': 'no-store'");
	});
});
