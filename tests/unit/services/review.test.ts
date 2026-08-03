import { describe, expect, it } from 'vitest';
import {
	listReviewItems,
	ReviewServiceError,
	type ReviewClientLike
} from '../../../src/lib/services/review';

const pageId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';

function row(overrides: Record<string, unknown> = {}) {
	return {
		page_id: pageId,
		document_id: documentId,
		document_title: 'Biologia',
		document_kind: 'pdf',
		page_number: 4,
		page_status: 'needs_review',
		excerpt: 'Texto incerto',
		warnings: [{ code: 'uncertain_text', message: 'Margem ilegível' }],
		updated_at: '2026-08-02T05:00:00.000Z',
		...overrides
	};
}

function client(rows: unknown[]): ReviewClientLike {
	return {
		async rpc() {
			return { data: rows, error: null };
		}
	};
}

describe('listReviewItems', () => {
	it('maps safe review queue records', async () => {
		await expect(listReviewItems({ limit: 25, offset: 0 }, client([row()]))).resolves.toEqual([
			{
				pageId,
				documentId,
				documentTitle: 'Biologia',
				documentKind: 'pdf',
				pageNumber: 4,
				pageStatus: 'needs_review',
				excerpt: 'Texto incerto',
				warnings: [{ code: 'uncertain_text', message: 'Margem ilegível' }],
				updatedAt: '2026-08-02T05:00:00.000Z'
			}
		]);
	});

	it('rejects pagination before constructing the default Supabase client', async () => {
		await expect(listReviewItems({ limit: 101 }, client([]))).rejects.toThrow(
			'Invalid review limit'
		);
		await expect(listReviewItems({ offset: -1 }, client([]))).rejects.toThrow(
			'Invalid review offset'
		);
		await expect(listReviewItems({ limit: 101 })).rejects.toThrow('Invalid review limit');
		await expect(listReviewItems({ offset: -1 })).rejects.toThrow('Invalid review offset');
	});

	it('rejects malformed or extra RPC row fields', async () => {
		const { page_id: _pageId, ...missingPageId } = row();
		await expect(listReviewItems({}, client([missingPageId]))).rejects.toBeInstanceOf(
			ReviewServiceError
		);
		await expect(
			listReviewItems({}, client([row({ page_id: 'bad-id' })]))
		).rejects.toBeInstanceOf(ReviewServiceError);
		await expect(
			listReviewItems({}, client([row({ private_content: 'no' })]))
		).rejects.toBeInstanceOf(ReviewServiceError);
		await expect(
			listReviewItems({}, client([row({ warnings: [{ code: 'bad' }] })]))
		).rejects.toBeInstanceOf(ReviewServiceError);
	});

	it('normalizes transport failures without leaking backend details', async () => {
		const transport: ReviewClientLike = {
			async rpc() {
				throw new Error('internal database hostname leaked');
			}
		};

		await expect(listReviewItems({}, transport)).rejects.toEqual(
			expect.objectContaining({
				name: 'ReviewServiceError',
				message: 'Não foi possível carregar a fila de revisão.'
			})
		);
	});
});
