import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionPath = 'supabase/functions/drive-resolve-folder/index.ts';
const servicePath = 'src/lib/drive/resolve-folder.ts';
const rpc = (name: string) => new RegExp(`rpc\\(\\s*['"]${name}['"]`);
const tokenInBrowserResponse = (name: 'accessToken' | 'refreshToken') =>
	new RegExp(`respond\\([\\s\\S]{0,180}\\b${name}\\b`);

describe('Drive folder resolution boundary', () => {
	it('authenticates, validates the hierarchy, and persists each created folder identity', () => {
		const source = readFileSync(functionPath, 'utf8');

		expect(source).toContain('auth.getUser()');
		expect(source).toContain('parseDriveNotebookRows');
		expect(source).toContain('buildNotebookFolderChain');
		expect(source).toMatch(rpc('get_drive_refresh_token'));
		expect(source).toContain('refreshGoogleAccessToken');
		expect(source).toContain('ensureDriveFolder');
		expect(source).toContain(".from('notebooks')");
		expect(source).toContain('drive_folder_id: folder.id');
		expect(source).toContain("'Cache-Control': 'no-store'");
		expect(source).not.toMatch(tokenInBrowserResponse('refreshToken'));
		expect(source).not.toMatch(tokenInBrowserResponse('accessToken'));
	});

	it('exposes only a strict folderId result to the browser', () => {
		const source = readFileSync(servicePath, 'utf8');

		expect(source).toContain("invoke('drive-resolve-folder'");
		expect(source).toContain('folderId: z.string().regex');
		expect(source).toContain('.strict()');
		expect(source).not.toContain('localStorage');
		expect(source).not.toContain('sessionStorage');
	});
});
