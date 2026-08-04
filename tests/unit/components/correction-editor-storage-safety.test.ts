import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/CorrectionEditor.svelte', 'utf8');

describe('CorrectionEditor local draft safety', () => {
	it('uses the safe draft boundary without making remote save depend on direct Storage access', () => {
		expect(source).not.toContain('localStorage.');
		expect(source).toContain('writeCorrectionDraft');
		expect(source).toContain('readCorrectionDraft');
		expect(source).toContain('discardCorrectionDraft');
		expect(source).toContain('createLatestSerialExecutor');
		expect(source).toContain('const saved = await savePageCorrection(page.id, request.text)');
	});

	it('distinguishes remote success from local draft cleanup failure', () => {
		expect(source).toContain(
			'A correção foi salva no servidor, mas o rascunho local não pôde ser removido.'
		);
		expect(source).toContain(
			'Não foi possível salvar no servidor e o navegador não permitiu criar um rascunho local.'
		);
	});

	it('does not publish save completion after the editor leaves the page', () => {
		expect(source).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(source).toContain('const editorLifecycle = new RequestVersion();');
		expect(source).toContain('const lifecycleVersion = editorLifecycle.next();');
		expect(source).toMatch(
			/const saved = await savePageCorrection\(page\.id, request\.text\);[\s\S]*if \(!editorLifecycle\.isCurrent\(lifecycleVersion\)\) return;[\s\S]*onSaved\?\.\(saved\);/
		);
		expect(source).toMatch(
			/catch \{[\s\S]*if \(!editorLifecycle\.isCurrent\(lifecycleVersion\)\) return;[\s\S]*saveState = 'error';/
		);
		expect(source).toMatch(/onDestroy\(\(\) => \{[\s\S]*editorLifecycle\.next\(\);[\s\S]*\}\);/);
	});
});
