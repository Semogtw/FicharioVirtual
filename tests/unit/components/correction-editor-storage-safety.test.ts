import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/CorrectionEditor.svelte', 'utf8');

describe('CorrectionEditor local draft safety', () => {
	it('uses the safe draft boundary without making remote save depend on direct Storage access', () => {
		expect(source).not.toContain('localStorage.');
		expect(source).toContain('writeCorrectionDraft');
		expect(source).toContain('readCorrectionDraft');
		expect(source).toContain('discardCorrectionDraft');
		expect(source).toContain('const saved = await savePageCorrection(page.id, text)');
	});

	it('distinguishes remote success from local draft cleanup failure', () => {
		expect(source).toContain(
			'A correção foi salva no servidor, mas o rascunho local não pôde ser removido.'
		);
		expect(source).toContain(
			'Não foi possível salvar no servidor e o navegador não permitiu criar um rascunho local.'
		);
	});
});
