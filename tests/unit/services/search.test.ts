import { describe, expect, it } from 'vitest';
import {
	searchPages,
	SearchServiceError,
	type SearchClientLike
} from '../../../src/lib/services/search';

type SearchResponse = { data: unknown; error: unknown };
type SearchRequest = ReturnType<SearchClientLike['rpc']>;

const pageId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';

function row(overrides: Record<string, unknown> = {}) {
	return {
		page_id: pageId,
		document_id: documentId,
		document_title: 'Fotossíntese',
		notebook_id: null,
		notebook_name: null,
		page_number: 3,
		excerpt: 'A fotossíntese ocorre no cloroplasto.',
		rank: 1.4,
		...overrides
	};
}

function client(rows: unknown[] = [], rejection?: unknown) {
	let args: Record<string, unknown> | null = null;
	let signal: AbortSignal | null = null;
	const value: SearchClientLike = {
		rpc(_name, input) {
			args = input;
			const request: SearchRequest = {
				abortSignal(inputSignal) {
					signal = inputSignal;
					return request;
				},
				then<TResult1 = SearchResponse, TResult2 = never>(
					onfulfilled?: ((value: SearchResponse) => TResult1 | PromiseLike<TResult1>) | null,
					onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
				): PromiseLike<TResult1 | TResult2> {
					const pending = rejection
						? Promise.reject(rejection)
						: Promise.resolve<SearchResponse>({ data: rows, error: null });
					return pending.then(onfulfilled, onrejected);
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
		const fixture = client([row()]);
		const controller = new AbortController();

		await expect(
			searchPages(
				' fotossintese ',
				{ notebookId: null, limit: 20, offset: 40, signal: controller.signal },
				fixture.value
			)
		).resolves.toEqual([
			{
				pageId,
				documentId,
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

	it('rejects malformed or extra RPC result fields', async () => {
		const missingPageId = { ...row() } as Record<string, unknown>;
		delete missingPageId.page_id;
		await expect(searchPages('texto', {}, client([missingPageId]).value)).rejects.toBeInstanceOf(
			SearchServiceError
		);
		await expect(
			searchPages('texto', {}, client([row({ page_id: 'bad-id' })]).value)
		).rejects.toBeInstanceOf(SearchServiceError);
		await expect(
			searchPages('texto', {}, client([row({ private_content: 'no' })]).value)
		).rejects.toBeInstanceOf(SearchServiceError);
	});

	it('normalizes transport failures but preserves cancellation', async () => {
		await expect(
			searchPages('texto', {}, client([], new Error('internal search host')).value)
		).rejects.toEqual(
			expect.objectContaining({
				name: 'SearchServiceError',
				message: 'Não foi possível pesquisar o fichário agora.'
			})
		);

		const aborted = new DOMException('cancelled by caller', 'AbortError');
		await expect(searchPages('texto', {}, client([], aborted).value)).rejects.toBe(aborted);
	});
});
