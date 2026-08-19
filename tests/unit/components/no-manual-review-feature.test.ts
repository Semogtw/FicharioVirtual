import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('manual review removal', () => {
	it('does not ship review routes or the correction editor', () => {
		for (const path of [
			'src/routes/review/+page.svelte',
			'src/routes/review/+layout.svelte',
			'src/routes/review/drafts/+page.svelte',
			'src/lib/components/CorrectionEditor.svelte',
			'src/lib/services/review.ts',
			'src/lib/services/draft-locations.ts'
		]) {
			expect(existsSync(new URL(path, repositoryRoot)), path).toBe(false);
		}
	});

	it('does not advertise review as a user destination', () => {
		const surfaces = [
			read('src/lib/components/AppShell.svelte'),
			read('src/lib/components/MobileNavigation.svelte'),
			read('src/routes/+page.svelte'),
			read('src/routes/settings/usage/+page.svelte'),
			read('src/routes/library/+page.svelte')
		];

		for (const source of surfaces) {
			expect(source).not.toContain('/review/');
			expect(source).not.toContain('Para revisar');
		}
	});

	it('keeps document viewing original-first without a correction surface', () => {
		const documentRoute = read('src/routes/documents/[id]/+page.svelte');
		expect(documentRoute).toContain('<h2>Original</h2>');
		expect(documentRoute).not.toContain('CorrectionEditor');
		expect(documentRoute).not.toContain('Texto corrigido');
		expect(documentRoute).not.toContain('transcrição auxiliar');
	});

	it('does not keep a programmatic manual-correction write path', () => {
		const detailService = read('src/lib/services/document-detail.ts');
		expect(detailService).not.toContain('savePageCorrection');
		expect(detailService).not.toContain('saveCorrection');
		expect(detailService).not.toContain('invalid_correction');
	});

	it('never turns low-confidence OCR into a review task in the import tray', () => {
		const queueTray = read('src/lib/components/ImportQueueTray.svelte');
		expect(queueTray).not.toContain('Pronto para revisão');
		expect(queueTray).toContain("item.status = 'complete';");
	});
});
