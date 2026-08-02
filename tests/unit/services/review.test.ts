import { describe, expect, it } from 'vitest';
import { listReviewItems, type ReviewClientLike } from '../../../src/lib/services/review';

function client(rows: unknown[]): ReviewClientLike {
	return {
		async rpc() {
			return { data: rows, error: null };
		}
	};
}

describe('listReviewItems', () => {
	it('maps safe review queue records', async () => {
		await expect(
			listReviewItems(
				{ limit: 25, offset: 0 },
				client([
					{
						page_id: 'page-1',
						document_id: 'document-1',
						document_title: 'Biologia',
						document_kind: 'pdf',
						page_number: 4,
						page_status: 'needs_review',
						excerpt: 'Texto incerto',
						warnings: [{ code: 'uncertain_text', message: 'Margem ilegível' }],
						updated_at: '2026-08-02T05:00:00.000Z'
					}
				])
			)
		).resolves.toEqual([
			{
				pageId: 'page-1',
				documentId: 'document-1',
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
});
