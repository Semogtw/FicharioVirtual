import { describe, expect, it } from 'vitest';
import { highlightSnippet } from '../../../src/lib/search/highlight';

describe('highlightSnippet', () => {
	it('highlights accent-insensitive terms while preserving original text', () => {
		expect(highlightSnippet('Fotossíntese e mitocôndria.', 'fotossintese mitocondria')).toEqual([
			{ text: 'Fotossíntese', highlighted: true },
			{ text: ' e ', highlighted: false },
			{ text: 'mitocôndria', highlighted: true },
			{ text: '.', highlighted: false }
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
