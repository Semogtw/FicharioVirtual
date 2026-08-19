import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/UnifiedImportPage.svelte', 'utf8');

describe('Unified import UX', () => {
	it('keeps pending selections when notebook loading fails and exposes retry', () => {
		expect(source).toContain("notebookError = 'Não foi possível carregar os cadernos agora.'");
		expect(source).toContain(
			'Seus arquivos continuam selecionados. Tente carregar os cadernos novamente.'
		);
		expect(source).toContain('onclick={() => void loadNotebookOptions()}');

		const catchBlock = source.slice(
			source.indexOf('async function loadNotebookOptions'),
			source.indexOf('$effect(() =>', source.indexOf('async function loadNotebookOptions'))
		);
		expect(catchBlock).not.toContain('pendingSelections = [];\n\t\t\tnotebookError');
	});

	it('confirms before discarding a multi-page photo draft', () => {
		expect(source).toContain('function requestClearPhotoDraft()');
		expect(source).toContain('if (photoDraft.length <= 1)');
		expect(source).toContain('confirmDiscard = true');
		expect(source).toContain('title="Descartar este documento de fotos?"');
		expect(source).toContain('onclick={requestClearPhotoDraft}');
	});

	it('avoids robotic parenthesized plural labels in the import flow', () => {
		expect(source).not.toContain('foto(s)');
		expect(source).not.toContain('arquivo(s)');
		expect(source).not.toContain('página(s)');
		expect(source).not.toContain('documento(s)');
	});
});