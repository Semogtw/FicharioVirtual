import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/routes/drive/+page.svelte';

describe('Drive recovery page', () => {
	it('loads missing documents and conflicts and offers explicit reconnection', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('listDriveRecovery');
		expect(source).toContain('selectGoogleDriveFile');
		expect(source).toContain('resolveDriveFolder');
		expect(source).toContain('copyBrowserDriveFile');
		expect(source).toContain('reconnectMissingDriveDocument');
		expect(source).toContain("label={busyId === document.id ? 'Reconectando…' : 'Reconectar'}");
		expect(source).toContain('Arquivos ausentes');
		expect(source).toContain('Itens com conflito');
	});

	it('rolls back a copied replacement if metadata reconnection fails', () => {
		const source = readFileSync(path, 'utf8');
		const reconnectIndex = source.indexOf('reconnectMissingDriveDocument');
		const rollbackIndex = source.indexOf('deleteBrowserDriveFile');

		expect(reconnectIndex).toBeGreaterThan(0);
		expect(rollbackIndex).toBeGreaterThan(reconnectIndex);
		expect(source).toContain('copiedFileId');
		expect(source).not.toContain('localStorage');
		expect(source).not.toContain('sessionStorage');
		expect(source).not.toContain('accessToken');
		expect(source).not.toContain('refreshToken');
	});
});
