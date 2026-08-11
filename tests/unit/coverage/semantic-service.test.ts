import { describe, expect, it, vi } from 'vitest';
import {
	requestSemanticCoverage,
	SemanticCoverageServiceError
} from '../../../src/lib/services/semantic-coverage';

const topic = 'Primeira lei da termodinâmica';
const candidate = {
	pageId: '11111111-1111-4111-8111-111111111111',
	documentId: '22222222-2222-4222-8222-222222222222',
	documentTitle: 'Termodinâmica',
	notebookId: null,
	notebookName: null,
	pageNumber: 3,
	excerpt: 'A variação da energia interna depende do calor e do trabalho.',
	lexicalRank: 0.2,
	semanticSimilarity: 0.84,
	verification: { coverage: 'strong', confidence: 0.95 }
} as const;

describe('semantic coverage service', () => {
	it('parses the strict hybrid response and forwards the abort signal', async () => {
		const signal = new AbortController().signal;
		const invoke = vi.fn().mockResolvedValue({
			data: {
				mode: 'hybrid',
				reason: null,
				embeddingModel: 'gemini-embedding-2',
				index: { totalPages: 12, indexedPages: 9, indexedThisRun: 4, complete: false },
				verification: 'used',
				topics: [{ topic, candidates: [candidate] }]
			},
			error: null
		});
		const result = await requestSemanticCoverage([topic], { signal }, { functions: { invoke } });
		expect(invoke).toHaveBeenCalledWith('semantic-coverage', {
			body: { topics: [topic], notebookId: null },
			signal
		});
		expect(result.analysis.mode).toBe('hybrid');
		expect(result.analysis.index?.indexedPages).toBe(9);
		expect(result.topics[0]?.candidates[0]?.verification?.coverage).toBe('strong');
	});

	it('accepts a provider lexical fallback response', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: {
				mode: 'lexical',
				reason: 'semantic_quota_or_rate_limit',
				embeddingModel: 'gemini-embedding-2',
				index: null,
				verification: 'unavailable',
				topics: [{ topic, candidates: [{ ...candidate, semanticSimilarity: 0, verification: null }] }]
			},
			error: null
		});
		const result = await requestSemanticCoverage([topic], {}, { functions: { invoke } });
		expect(result.analysis.mode).toBe('lexical');
		expect(result.analysis.reason).toBe('semantic_quota_or_rate_limit');
	});

	it('rejects response shape drift rather than trusting provider data', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: {
				mode: 'hybrid',
				reason: null,
				embeddingModel: 'gemini-embedding-2',
				index: null,
				verification: 'used',
				topics: [{ topic, candidates: [{ ...candidate, surprise: true }] }]
			},
			error: null
		});
		await expect(
			requestSemanticCoverage([topic], {}, { functions: { invoke } })
		).rejects.toBeInstanceOf(SemanticCoverageServiceError);
	});
});
