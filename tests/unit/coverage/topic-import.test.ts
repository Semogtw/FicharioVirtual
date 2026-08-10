import { describe, expect, it } from 'vitest';
import { extractTopicCandidatesFromOcr } from '../../../src/lib/coverage/topic-import';

describe('extractTopicCandidatesFromOcr', () => {
	it('turns a numbered OCR list into individual editable candidates', () => {
		const result = extractTopicCandidatesFromOcr(`
CONTEÚDO PROGRAMÁTICO
3. Termodinâmica
3.1 Temperatura
3.2 Calor específico
3.2.1 Capacidade térmica
3.3 Mudanças de fase
`);

		expect(result.topics.map((topic) => topic.text)).toEqual([
			'Termodinâmica',
			'Temperatura',
			'Calor específico',
			'Capacidade térmica',
			'Mudanças de fase'
		]);
		expect(result.topics.map((topic) => topic.level)).toEqual([0, 1, 1, 2, 1]);
		expect(result.topics.every((topic) => topic.confidence === 'high')).toBe(true);
	});

	it('merges wrapped OCR lines into the previous marked item', () => {
		const result = extractTopicCandidatesFromOcr(`
1. Primeira lei da termodinâmica e conservação
   de energia em sistemas fechados
2. Máquinas térmicas
`);

		expect(result.topics.map((topic) => topic.text)).toEqual([
			'Primeira lei da termodinâmica e conservação de energia em sistemas fechados',
			'Máquinas térmicas'
		]);
	});

	it('keeps unnumbered lists as separate fields with medium confidence', () => {
		const result = extractTopicCandidatesFromOcr(`
Temperatura
Calor específico
Mudanças de fase
`);

		expect(result.topics.map((topic) => topic.text)).toEqual([
			'Temperatura',
			'Calor específico',
			'Mudanças de fase'
		]);
		expect(result.topics.every((topic) => topic.confidence === 'medium')).toBe(true);
	});

	it('downgrades confidence when OCR itself requests review', () => {
		const result = extractTopicCandidatesFromOcr('1. Calor específico\n2. Dilatação térmica', {
			pageNeedsReview: true,
			warningCount: 1
		});

		expect(result.topics.map((topic) => topic.confidence)).toEqual(['low', 'low']);
		expect(result.topics.every((topic) => topic.reviewRequired)).toBe(true);
	});

	it('deduplicates accent-insensitively and removes generic headers', () => {
		const result = extractTopicCandidatesFromOcr(`
EMENTA
• Calor específico
• Calor especifico
• Máquinas térmicas
`);

		expect(result.topics.map((topic) => topic.text)).toEqual([
			'Calor específico',
			'Máquinas térmicas'
		]);
		expect(result.skippedLines).toBeGreaterThan(0);
	});

	it('marks suspicious OCR text for review instead of silently trusting it', () => {
		const result = extractTopicCandidatesFromOcr('1. Calor �@@@ específico\n2. Temperatura');
		expect(result.topics[0]?.confidence).toBe('medium');
		expect(result.topics[1]?.confidence).toBe('high');
	});
});
