import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/coverage/+page.svelte', 'utf8');

describe('coverage topic entry UX', () => {
	it('turns Enter/newlines into editable topics inside the same input card', () => {
		expect(source).toContain('onkeydown={handleBulkKeydown}');
		expect(source).toContain('oninput={handleBulkInput}');
		expect(source).toContain('addTopicAfter(index)');
		expect(source).toContain('data-topic-id={topic.id}');
		expect(source).not.toContain('Transformar em campos');
		expect(source).not.toContain('Conteúdos estruturados');
	});

	it('does not expose semantic/OCR implementation prose on the coverage page', () => {
		expect(source).not.toContain('textual/fuzzy');
		expect(source).not.toContain('Gemini');
		expect(source).not.toContain('similaridade por embeddings');
		expect(source).not.toContain('confiança do OCR');
		expect(source).not.toContain('arquivo temporário');
	});
});
