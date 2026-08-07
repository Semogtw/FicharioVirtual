import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'supabase/functions/drive-sync/index.ts';
const rpc = (name: string) => new RegExp(`rpc\\(\\s*['"]${name}['"]`);

describe('Drive sync Edge Function boundary', () => {
	it('authenticates the Fichário user and obtains credentials only through service RPCs', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('auth.getUser()');
		expect(source).toMatch(rpc('get_drive_refresh_token'));
		expect(source).toMatch(rpc('begin_drive_remote_sync'));
		expect(source).toContain('refreshGoogleAccessToken');
		expect(source).not.toContain(".from('drive_credentials')");
		expect(source).not.toContain("select('refresh_token')");
		expect(source).not.toContain('GOOGLE_DRIVE_SCOPE');
	});

	it('applies every change before advancing its compare-and-swap checkpoint', () => {
		const source = readFileSync(path, 'utf8');
		const fetchIndex = source.indexOf('await listGoogleDriveChanges');
		const applyIndex = source.search(rpc('apply_drive_remote_change'));
		const checkpointIndex = source.search(rpc('persist_drive_change_checkpoint'));

		expect(fetchIndex).toBeGreaterThan(0);
		expect(applyIndex).toBeGreaterThan(fetchIndex);
		expect(checkpointIndex).toBeGreaterThan(applyIndex);
		expect(source).toContain('MAX_PAGES_PER_INVOCATION');
		expect(source).toContain("'Cache-Control': 'no-store'");
	});

	it('persists a sanitized resumable failure without exposing access tokens', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toMatch(rpc('fail_drive_remote_sync'));
		expect(source).toContain("code: 'drive_sync_failed'");
		expect(source).not.toContain('accessToken:');
		expect(source).not.toContain('refreshToken:');
		expect(source).not.toContain('JSON.stringify(error)');
	});
});
