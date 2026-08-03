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

describe('draft location response contract', () => {
	const documentId = '22222222-2222-4222-8222-222222222222';
	const otherPageId = '33333333-3333-4333-8333-333333333333';

	function client(data: unknown, rejection?: unknown): DraftLocationClientLike {
		return {
			async rpc() {
				if (rejection) throw rejection;
				return { data, error: null };
			}
		};
	}

	it('rejects unrequested, duplicate or malformed locations', async () => {
		const valid = {
			page_id: pageId,
			document_id: documentId,
			document_title: 'Biologia',
			page_number: 3,
			page_updated_at: '2026-08-02T09:00:00.000Z'
		};

		await expect(
			resolveDraftLocations([pageId], client([{ ...valid, page_id: otherPageId }]))
		).rejects.toMatchObject({ name: 'DraftLocationError' });
		await expect(resolveDraftLocations([pageId], client([valid, valid]))).rejects.toMatchObject({
			name: 'DraftLocationError'
		});
		await expect(
			resolveDraftLocations([pageId], client([{ ...valid, private_text: 'no' }]))
		).rejects.toMatchObject({ name: 'DraftLocationError' });
		await expect(
			resolveDraftLocations(
				[pageId],
				client([{ ...valid, page_updated_at: '2026-02-30T00:00:00.000Z' }])
			)
		).rejects.toMatchObject({ name: 'DraftLocationError' });
	});

	it('normalizes transport failures without leaking details', async () => {
		await expect(
			resolveDraftLocations([pageId], client(null, new Error('internal drafts host')))
		).rejects.toEqual(
			expect.objectContaining({
				name: 'DraftLocationError',
				message: 'Não foi possível localizar os rascunhos.'
			})
		);
	});
});
