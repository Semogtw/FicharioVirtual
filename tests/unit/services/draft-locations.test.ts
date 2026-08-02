import { describe, expect, it } from 'vitest';
import {
	resolveDraftLocations,
	type DraftLocationClientLike
} from '../../../src/lib/services/draft-locations';

const pageId = '11111111-1111-4111-8111-111111111111';

describe('resolveDraftLocations', () => {
	it('maps page locations without returning remote text', async () => {
		const client: DraftLocationClientLike = {
			async rpc() {
				return {
					data: [
						{
							page_id: pageId,
							document_id: '22222222-2222-4222-8222-222222222222',
							document_title: 'Biologia',
							page_number: 3,
							page_updated_at: '2026-08-02T09:00:00.000Z'
						}
					],
					error: null
				};
			}
		};

		await expect(resolveDraftLocations([pageId], client)).resolves.toEqual([
			{
				pageId,
				documentId: '22222222-2222-4222-8222-222222222222',
				documentTitle: 'Biologia',
				pageNumber: 3,
				pageUpdatedAt: '2026-08-02T09:00:00.000Z'
			}
		]);
	});

	it('does not call the backend for an empty draft list', async () => {
		let called = false;
		const client: DraftLocationClientLike = {
			async rpc() {
				called = true;
				return { data: [], error: null };
			}
		};
		await expect(resolveDraftLocations([], client)).resolves.toEqual([]);
		expect(called).toBe(false);
	});

	it('rejects more than one hundred page identifiers', async () => {
		const ids = Array.from(
			{ length: 101 },
			(_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
		);
		await expect(resolveDraftLocations(ids)).rejects.toThrow('Too many draft locations');
	});
});
