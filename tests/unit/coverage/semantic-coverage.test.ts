import { describe, expect, it } from 'vitest';
import {
	classifySemanticTopicCoverage,
	scoreSemanticCoverageCandidate,
	summarizeSemanticCoverage,
	type SemanticCoverageCandidate
} from '../../../src/lib/coverage/semantic-coverage';

function candidate(
	overrides: Partial<SemanticCoverageCandidate> = {}
): SemanticCoverageCandidate {
	return Object.freeze({
		pageId: '11111111-1111-4111-8111-111111111111',
		documentId: '22222222-2222-4222-8222-222222222222',
		documentTitle: 'Termodinâmica',
		notebookId: null,
		notebookName: null,
		pageNumber: 1,
		excerpt: 'A variação da energia interna depende do calor recebido e do trabalho realizado.',
		lexicalRank: 0,
		semanticSimilarity: 0,
		verification: null,
		...overrides
	});
}

describe('semantic topic coverage', () => {
	it('recognizes a strong semantic relation even without lexical overlap', () => {
		const coverage = classifySemanticTopicCoverage('Primeira lei da termodinâmica', [
			candidate({ semanticSimilarity: 0.81 })
		]);
		expect(coverage.status).toBe('covered');
		expect(coverage.strength).toBeGreaterThanOrEqual(90);
		expect(coverage.evidence).toHaveLength(1);
	});

	it('keeps medium semantic similarity conservative', () => {
		const coverage = classifySemanticTopicCoverage('Entropia', [
			candidate({ semanticSimilarity: 0.62 })
		]);
		expect(coverage.status).toBe('partial');
	});

	it('does not promote weak semantic proximity', () => {
		const coverage = classifySemanticTopicCoverage('Entropia', [
			candidate({ semanticSimilarity: 0.5 })
		]);
		expect(coverage.status).toBe('missing');
	});

	it('combines lexical and semantic evidence without a second model verdict', () => {
		const item = candidate({ lexicalRank: 1.2, semanticSimilarity: 0.78 });
		expect(scoreSemanticCoverageCandidate(item)).toBeGreaterThan(0.9);
		expect(classifySemanticTopicCoverage('Calor', [item]).status).toBe('covered');
	});

	it('deduplicates evidence and preserves analysis metadata', () => {
		const first = classifySemanticTopicCoverage('Energia interna', [
			candidate({ lexicalRank: 1.1 }),
			candidate({ lexicalRank: 0.8, excerpt: 'duplicado' })
		]);
		expect(first.evidence).toHaveLength(1);
		const summary = summarizeSemanticCoverage([first], {
			mode: 'hybrid',
			reason: null,
			embeddingModel: 'gemini-embedding-2',
			index: {
				totalPages: 10,
				indexedPages: 8,
				indexedThisRun: 0,
				complete: false
			},
			verification: 'disabled'
		});
		expect(summary.analysis?.mode).toBe('hybrid');
		expect(summary.analysis?.index?.indexedPages).toBe(8);
		expect(summary.analysis?.verification).toBe('disabled');
	});
});
