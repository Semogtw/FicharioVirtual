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

	it('lets a confident verifier reject a lexical false positive', () => {
		const item = candidate({
			lexicalRank: 1.2,
			semanticSimilarity: 0.78,
			verification: { coverage: 'none', confidence: 0.98 }
		});
		expect(scoreSemanticCoverageCandidate(item)).toBeLessThan(0.3);
		expect(classifySemanticTopicCoverage('Calor', [item]).status).toBe('missing');
	});

	it('lets a confident verifier promote substantial conceptual evidence', () => {
		const coverage = classifySemanticTopicCoverage('Primeira lei da termodinâmica', [
			candidate({
				semanticSimilarity: 0.58,
				verification: { coverage: 'strong', confidence: 0.9 }
			})
		]);
		expect(coverage.status).toBe('covered');
		expect(coverage.strength).toBeGreaterThan(90);
	});

	it('never lets a verifier partial verdict become fully covered', () => {
		const coverage = classifySemanticTopicCoverage('Calor específico', [
			candidate({
				lexicalRank: 1.4,
				semanticSimilarity: 0.9,
				verification: { coverage: 'partial', confidence: 1 }
			})
		]);
		expect(coverage.status).toBe('partial');
		expect(coverage.strength).toBeLessThan(78);
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
				indexedThisRun: 3,
				complete: false
			},
			verification: 'used'
		});
		expect(summary.analysis?.mode).toBe('hybrid');
		expect(summary.analysis?.index?.indexedPages).toBe(8);
	});
});
