import { describe, expect, it } from 'vitest';
import {
	searchPagesHybrid,
	SemanticSearchServiceError
} from '../../../src/lib/services/semantic-search';

const pageId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';

type FunctionClient = NonNullable<Parameters<typeof searchPagesHybrid>[2]>;

function hybridResponse() {
	return {
		mode: 'hybrid',
		reason: null,
		embeddingModel: 'gemini-embedding-2',
		index: { totalPages: 12, indexedPages: 8, indexedThisRun: 2, complete: false },
		hasMore: false,
		results: [
			{
				pageId,
				documentId,
				documentTitle: 'Termodinâmica',
				notebookId: null,
				notebookName: null,
				pageNumber: 4,
				excerpt: 'A variação da energia interna corresponde ao calor e ao trabalho trocados.',
				rank: 0.91,
				lexicalRank: 0.04,
				semanticSimilarity: 0.82,
				matchMode: 'hybrid'
			}
		]
	};
}

function functionClient(data: unknown): FunctionClient {
	return {
		functions: {
			async invoke(name, options) {
				expect(name).toBe('semantic-search');
				expect(options.body).toEqual({
					query: 'conservação de energia',
					notebookId: null,
					limit: 20,
					offset: 0
				});
				return { data, error: null };
			}
		}
	};
}

describe('searchPagesHybrid', () => {
	it('accepts semantic and hybrid matches without requiring literal overlap', async () => {
		const response = await searchPagesHybrid(
			' conservação de energia ',
			{ limit: 20 },
			functionClient(hybridResponse())
		);

		expect(response.analysis).toEqual({
			mode: 'hybrid',
			reason: null,
			embeddingModel: 'gemini-embedding-2',
			index: { totalPages: 12, indexedPages: 8, indexedThisRun: 2, complete: false }
		});
		expect(response.results[0]).toEqual(
			expect.objectContaining({
				pageId,
				matchMode: 'hybrid',
				semanticSimilarity: 0.82
			})
		);
	});

	it('does not call the Edge Function for a blank query', async () => {
		let called = false;
		const client: FunctionClient = {
			functions: {
				async invoke() {
					called = true;
					return { data: null, error: null };
				}
			}
		};
		await expect(searchPagesHybrid('   ', {}, client)).resolves.toEqual(
			expect.objectContaining({ results: [], hasMore: false })
		);
		expect(called).toBe(false);
	});

	it('rejects malformed provider responses instead of trusting extra private fields', async () => {
		const response = hybridResponse();
		response.results[0] = { ...response.results[0], privateText: 'no' } as never;
		await expect(
			searchPagesHybrid('conservação de energia', { limit: 20 }, functionClient(response))
		).rejects.toBeInstanceOf(SemanticSearchServiceError);
	});
});
