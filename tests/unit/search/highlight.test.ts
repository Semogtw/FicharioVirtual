import { describe, expect, it } from 'vitest';
import { highlightSnippet, searchMatchSnippet } from '../../../src/lib/search/highlight';

describe('highlightSnippet', () => {
	it('highlights accent-insensitive terms while preserving original text', () => {
		expect(highlightSnippet('Fotossíntese e mitocôndria.', 'fotossintese mitocondria')).toEqual([
			{ text: 'Fotossíntese', highlighted: true },
			{ text: ' e ', highlighted: false },
			{ text: 'mitocôndria', highlighted: true },
			{ text: '.', highlighted: false }
		]);
	});

	it('highlights a likely OCR typo when the exact term is absent', () => {
		expect(highlightSnippet('A fotossintcse transforma energia luminosa.', 'fotossíntese')).toEqual([
			{ text: 'A ', highlighted: false },
			{ text: 'fotossintcse', highlighted: true },
			{ text: ' transforma energia luminosa.', highlighted: false }
		]);
	});

	it('does not fuzzy-highlight very short terms', () => {
		expect(highlightSnippet('DNA e RNA aparecem no texto.', 'DNB')).toEqual([
			{ text: 'DNA e RNA aparecem no texto.', highlighted: false }
		]);
	});

	it('merges overlapping matches and never returns HTML', () => {
		const parts = highlightSnippet('<script>fotossíntese</script>', 'foto fotossintese');

		expect(parts.map((part) => part.text).join('')).toBe('<script>fotossíntese</script>');
		expect(parts.some((part) => part.text.includes('<script>'))).toBe(true);
		expect(parts).not.toHaveProperty('html');
	});

	it('returns one plain part for an empty query', () => {
		expect(highlightSnippet('Texto original', '   ')).toEqual([
			{ text: 'Texto original', highlighted: false }
		]);
	});
});

describe('searchMatchSnippet', () => {
	it('centers a long OCR transcription around the approximate match', () => {
		const text = `${'início '.repeat(50)}fotossintcse ${'fim '.repeat(50)}`;
		const excerpt = searchMatchSnippet(text, 'fotossíntese', 100);

		expect(excerpt.startsWith('…')).toBe(true);
		expect(excerpt.endsWith('…')).toBe(true);
		expect(excerpt).toContain('fotossintcse');
		expect(highlightSnippet(excerpt, 'fotossíntese').some((part) => part.highlighted)).toBe(true);
	});
});
