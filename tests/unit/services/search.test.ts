import { describe, expect, it } from 'vitest';
import { searchPages, type SearchClientLike } from '../../../src/lib/services/search';

type SearchResponse = { data: unknown; error: unknown };
type SearchRequest = ReturnType<SearchClientLike['rpc']>;

function client(rows: unknown[] = []) {
	let args: Record<string, unknown> | null = null;
	let signal: AbortSignal | null = null;
	const value: SearchClientLike = {
		rpc(_name, input) {
			args = input;
			let request: SearchRequest;
			request = {
				abortSignal(inputSignal) {
					signal = inputSignal;
					return request;
				},
				then<TResult1 = SearchResponse, TResult2 = never>(
					onfulfilled?: ((value: SearchResponse) => TResult1 | PromiseLike<TResult1>) | null,
					onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
				): PromiseLike<TResult1 | TResult2> {
					return Promise.resolve<SearchResponse>({ data: rows, error: null }).then(
						onfulfilled,
						onrejected
					);
				}
			};
			return request;
		}
	};
	return {
		value,
		get args() {
			return args;
		},
		get signal() {
			return signal;
		}
	};
}

describe('searchPages', () => {
	it('does not call the backend for a blank query', async () => {
		const fixture = client();
		await expect(searchPages('   ', {}, fixture.value)).resolves.toEqual([]);
		expect(fixture.args).toBeNull();
	});

	it('sends bounded pagination and maps database fields', async () => {
		const fixture = client([
			{
				page_id: 'page-1',
				document_id: 'document-1',
				document_title: 'Fotossíntese',
				notebook_id: null,
				notebook_name: null,
				page_number: 3,
				excerpt: 'A fotossíntese ocorre no cloroplasto.',
				rank: 1.4
			}
		]);
		const controller = new AbortController();

		await expect(
			searchPages(
				' fotossintese ',
				{ notebookId: null, limit: 20, offset: 40, signal: controller.signal },
				fixture.value
			)
		).resolves.toEqual([
			{
				pageId: 'page-1',
				documentId: 'document-1',
				documentTitle: 'Fotossíntese',
				notebookId: null,
				notebookName: null,
				pageNumber: 3,
				excerpt: 'A fotossíntese ocorre no cloroplasto.',
				rank: 1.4
			}
		]);
		expect(fixture.args).toEqual({
			search_query: 'fotossintese',
			notebook_filter: null,
			result_limit: 20,
			result_offset: 40
		});
		expect(fixture.signal).toBe(controller.signal);
	});

	it('rejects query and pagination values outside the public contract', async () => {
		await expect(searchPages('x'.repeat(201))).rejects.toThrow('Invalid search query');
		await expect(searchPages('texto', { limit: 101 })).rejects.toThrow('Invalid search limit');
	});
});
