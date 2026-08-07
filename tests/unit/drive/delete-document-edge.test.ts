import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'supabase/functions/delete-document/index.ts';
const source = readFileSync(path, 'utf8');

function browserResponseContains(name: string) {
	return new RegExp(`respond\\(\\s*\\d+\\s*,\\s*['"]?[^)]*${name}`, 'i');
}

describe('delete-document Drive-first boundary', () => {
	it('deletes the controlled Drive original with a backend-refreshed access token', () => {
		expect(source).toContain(
			"import { deleteDriveFile } from '../_shared/google-drive-client.ts';"
		);
		expect(source).toContain(
			"import { refreshGoogleAccessToken } from '../_shared/google-oauth-http.ts';"
		);
		expect(source).toContain(
			".select('storage_path,thumbnail_path,drive_file_id,pages(temporary_image_path)')"
		);
		expect(source).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
		expect(source).toContain("Deno.env.get('GOOGLE_CLIENT_ID')");
		expect(source).toContain("Deno.env.get('GOOGLE_CLIENT_SECRET')");
		expect(source).toMatch(/admin\.rpc\(\s*['"]get_drive_refresh_token['"]/);
		expect(source).toContain('refreshGoogleAccessToken({');
		expect(source).toContain('deleteDriveFile({');
	});

	it('keeps storage-only deletion independent of Google configuration', () => {
		expect(source).toContain('if (document.drive_file_id !== null)');
		expect(source).toContain("return respond(503, 'drive_delete_not_configured')");
	});

	it('never returns or logs OAuth credentials', () => {
		expect(source).not.toMatch(browserResponseContains('refreshToken'));
		expect(source).not.toMatch(browserResponseContains('accessToken'));
		expect(source).not.toMatch(
			/console\.(?:log|info|warn|error)\([^)]*(?:refreshToken|accessToken)/i
		);
	});

	it('treats Supabase derivative cleanup as best-effort after the Drive original is gone', () => {
		const driveDelete = source.indexOf('await deleteDriveFile({');
		const storageRemove = source.indexOf("storage.from('documents').remove(paths)");
		const metadataDelete = source.indexOf("from('documents').delete()");
		expect(driveDelete).toBeGreaterThan(-1);
		expect(storageRemove).toBeGreaterThan(driveDelete);
		expect(metadataDelete).toBeGreaterThan(storageRemove);
		expect(source).toContain('if (document.drive_file_id === null && storageError)');
	});
});
