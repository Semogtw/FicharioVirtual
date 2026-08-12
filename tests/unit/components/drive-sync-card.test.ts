import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/lib/components/DriveConnectionCard.svelte';

describe('Drive synchronization settings UI', () => {
	it('offers synchronization only for an eligible connected account', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('synchronizeDriveConnection');
		expect(source).toContain('presentation.canSynchronize');
		expect(source).toContain("label={synchronizing ? 'Sincronizando…' : 'Sincronizar agora'}");
		expect(source).toContain('async function synchronize()');
		expect(source).toContain('await refresh()');
	});

	it('presents a user-facing sync receipt and never persists Drive credentials', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('Sincronização concluída.');
		expect(source).toContain('Google Drive atualizado.');
		expect(source).toContain('role="status"');
		expect(source).not.toContain('localStorage');
		expect(source).not.toContain('sessionStorage');
		expect(source).not.toContain('accessToken');
		expect(source).not.toContain('refreshToken');
		expect(source).not.toContain('pageToken');
	});
});
