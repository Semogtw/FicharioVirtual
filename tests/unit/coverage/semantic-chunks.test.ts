import { describe, expect, it } from 'vitest';
import {
	chunkSemanticText,
	SEMANTIC_CHUNK_MAX_CHARS,
	SEMANTIC_MAX_CHUNKS_PER_PAGE
} from '../../../supabase/functions/_shared/semantic-chunks';
import {
	normalizeSemanticDocumentText,
	normalizeSemanticQueryText
} from '../../../supabase/functions/_shared/semantic-text';

describe('semantic text normalization', () => {
	it('repairs conservative OCR layout artifacts before embedding', () => {
		expect(
			normalizeSemanticDocumentText(
				'A foto-\nssíntese ocorre na o\uFB01cina. Palavra oxi\u00ADtona.\r\n\r\nSegundo parágrafo.'
			)
		).toBe('A fotossíntese ocorre na oficina. Palavra oxitona.\n\nSegundo parágrafo.');
	});

	it('normalizes equivalent semantic queries deterministically', () => {
		expect(normalizeSemanticQueryText('  OXI\u00ADTONA \u200b ')).toBe('oxitona');
		expect(normalizeSemanticQueryText('Oxítona')).toBe('oxítona');
	});

	it('does not remove ordinary in-line hyphens', () => {
		expect(normalizeSemanticDocumentText('curso pré-vestibular')).toBe('curso pré-vestibular');
	});
});

describe('semantic text chunking', () => {
	it('returns nothing for blank input', () => {
		expect(chunkSemanticText('  \n\n ')).toEqual([]);
	});

	it('keeps short text as one normalized chunk', () => {
		expect(chunkSemanticText('Energia   interna.\r\n\r\nCalor e trabalho.')).toEqual([
			{ index: 0, text: 'Energia interna.\n\nCalor e trabalho.' }
		]);
	});

	it('dehyphenates OCR line wraps before deciding chunk boundaries', () => {
		expect(chunkSemanticText('A fotossín-\ntese depende da luz.')).toEqual([
			{ index: 0, text: 'A fotossíntese depende da luz.' }
		]);
	});

	it('splits long pages on useful boundaries with bounded overlap', () => {
		const sentence = 'A energia interna varia conforme calor e trabalho em um sistema fechado. ';
		const chunks = chunkSemanticText(sentence.repeat(90));
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.length).toBeLessThanOrEqual(SEMANTIC_MAX_CHUNKS_PER_PAGE);
		expect(chunks.every((chunk) => chunk.text.length <= SEMANTIC_CHUNK_MAX_CHARS)).toBe(true);
		expect(chunks[0]?.text).toContain('energia interna');
		expect(chunks[1]?.text).toContain('energia interna');
	});

	it('caps pathological pages instead of producing unbounded provider work', () => {
		const chunks = chunkSemanticText('conteúdo acadêmico '.repeat(10_000));
		expect(chunks).toHaveLength(SEMANTIC_MAX_CHUNKS_PER_PAGE);
	});
});
