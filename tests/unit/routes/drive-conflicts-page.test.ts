import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/routes/drive/conflicts/+page.svelte';

describe('Drive conflict resolution page', () => {
	it('loads conflicts and exposes only safe owner resolutions', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('listOpenDriveConflicts');
		expect(source).toContain('resolveDriveConflict');
		expect(source).toContain("label={busyId === conflict.id ? 'Reenfileirando…' : 'Tentar estado local'}");
		expect(source).toContain("label={busyId === conflict.id ? 'Aplicando…' : 'Aceitar ausência física'}");
		expect(source).toContain("conflict.kind === 'remote_deleted_local_changed'");
	});

	it('never renders snapshots or credentials', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).not.toContain('localSnapshot');
		expect(source).not.toContain('remoteSnapshot');
		expect(source).not.toContain('payload');
		expect(source).not.toContain('accessToken');
		expect(source).not.toContain('refreshToken');
	});
});
