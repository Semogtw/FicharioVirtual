import { describe, expect, it } from 'vitest';
import {
	classifyTopicCoverage,
	normalizeTopic,
	parseUnitTopics,
	summarizeUnitCoverage
} from '../../../src/lib/coverage/topic-coverage';
import { analyzeUnitCoverage, type TopicSearch } from '../../../src/lib/services/topic-coverage';
import type { SearchResult } from '../../../src/lib/services/search';

function result(rank: number, pageNumber = 1, documentId = '22222222-2222-4222-8222-222222222222') {
	return {
		pageId: `11111111-1111-4111-8111-${pageNumber.toString().padStart(12, '0')}`,
		documentId,
		documentTitle: 'Termodinâmica',
		notebookId: null,
		notebookName: null,
		pageNumber,
		excerpt: 'Energia interna, calor e trabalho.',
		rank
	} satisfies SearchResult;
}

describe('topic coverage model', () => {
	it('parses numbered and bulleted topics, removes duplicates and accents for comparison', () => {
		expect(
			parseUnitTopics(`
				3.1 Temperatura
				• Calor específico
				- Mudanças de fase
				Calor especifico
			`)
		).toEqual(['Temperatura', 'Calor específico', 'Mudanças de fase']);
		expect(normalizeTopic('  Máquinas térmicas! ')).toBe('maquinas termicas');
	});

	it('classifies strong, weak and absent evidence conservatively', () => {
		expect(classifyTopicCoverage('Calor', [result(1.2)]).status).toBe('covered');
		expect(classifyTopicCoverage('Calor', [result(0.55)]).status).toBe('partial');
		expect(classifyTopicCoverage('Calor', [result(0.2)]).status).toBe('missing');
		expect(classifyTopicCoverage('Calor', []).strength).toBe(0);
	});

	it('sorts and bounds the evidence returned to the interface', () => {
		const coverage = classifyTopicCoverage('Calor', [
			result(0.5, 1),
			result(1.1, 2),
			result(0.9, 3),
			result(0.8, 4),
			result(0.7, 5)
		]);
		expect(coverage.evidence).toHaveLength(4);
		expect(coverage.evidence.map((item) => item.rank)).toEqual([1.1, 0.9, 0.8, 0.7]);
	});

	it('calculates an overall weighted coverage percentage', () => {
		const summary = summarizeUnitCoverage([
			classifyTopicCoverage('A', [result(1)]),
			classifyTopicCoverage('B', [result(0.5)]),
			classifyTopicCoverage('C', [])
		]);
		expect(summary.percentage).toBe(50);
		expect(summary.counts).toEqual({ covered: 1, partial: 1, missing: 1 });
	});
});

describe('analyzeUnitCoverage', () => {
	it('uses the current fuzzy search for each topic and preserves input order', async () => {
		const seen: string[] = [];
		const search: TopicSearch = async (query) => {
			seen.push(query);
			return query === 'Calor específico' ? [result(1.3)] : [];
		};

		const summary = await analyzeUnitCoverage(
			'1. Calor específico\n2. Máquinas térmicas',
			{ concurrency: 2 },
			search
		);

		expect(seen.sort()).toEqual(['Calor específico', 'Máquinas térmicas'].sort());
		expect(summary.topics.map((topic) => topic.topic)).toEqual([
			'Calor específico',
			'Máquinas térmicas'
		]);
		expect(summary.counts).toEqual({ covered: 1, partial: 0, missing: 1 });
		expect(summary.percentage).toBe(50);
	});

	it('does not search anything when the pasted list has no topics', async () => {
		let calls = 0;
		const search: TopicSearch = async () => {
			calls += 1;
			return [];
		};
		await expect(analyzeUnitCoverage('  \n;', {}, search)).resolves.toEqual({
			topics: [],
			percentage: 0,
			counts: { covered: 0, partial: 0, missing: 0 }
		});
		expect(calls).toBe(0);
	});
});
